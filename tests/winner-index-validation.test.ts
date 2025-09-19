import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  computeGameOutcome,
  calculatePayoutBreakdown,
  getErrorCode,
  getErrorMessage,
} from "./test-helpers";

// Tests covering winner index validation errors

describe("Winner Index Validation", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  async function setupTwoPlayerGame() {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, player1] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    return { oracle, mint, gameData, creator, player1 };
  }

  function expectAnchorError(
    error: unknown,
    code: string,
    fallbackSubstring: string
  ) {
    const actualCode = getErrorCode(error);
    if (actualCode) {
      expect(actualCode).to.equal(code);
    } else {
      expect(getErrorMessage(error)).to.include(fallbackSubstring);
    }
  }

  it("should fail with WinnerIndexMismatch when provided index differs from recomputed", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { gameAccount, winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );
    const wrongIndex = (winnerIndex + 1) % gameAccount.ticketsCount; // ensure different but in range

    try {
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        wrongIndex
      );
      expect.fail("Should throw WinnerIndexMismatch");
    } catch (e: any) {
      expectAnchorError(e, "WinnerIndexMismatch", "Winner index mismatch");
    }
  });

  it("should fail with WinnerPubkeyHashMismatch when winner pubkey does not match stored hash", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const wrongWinner = participants.find((candidate) =>
      !candidate.player.publicKey.equals(winner.player.publicKey)
    );

    if (!wrongWinner) {
      throw new Error("Expected to find a non-winning participant");
    }

    try {
      await testUtils.game.completeGame(
        gameData,
        wrongWinner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );
      expect.fail("Should throw WinnerPubkeyHashMismatch");
    } catch (e: any) {
      expectAnchorError(
        e,
        "WinnerPubkeyHashMismatch",
        "Winner pubkey hash mismatch"
      );
    }
  });

  it("should fail with InvalidSecretKey when oracle submits mismatched secret", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const tamperedSecret = [...gameData.secretKey];
    tamperedSecret[0] = (tamperedSecret[0] + 1) % 256;

    try {
      await testUtils.game.completeGame(
        { ...gameData, secretKey: tamperedSecret },
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );
      expect.fail("Should throw InvalidSecretKey");
    } catch (e: any) {
      expectAnchorError(e, "InvalidSecretKey", "Invalid secret key");
    }
  });

  it("should fail when winner token account does not belong to supplied winner", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const wrongAccountOwner = participants.find((candidate) =>
      !candidate.player.publicKey.equals(winner.player.publicKey)
    );

    if (!wrongAccountOwner) {
      throw new Error("Expected a non-winning participant");
    }

    try {
      await env.program.methods
        .completeGame(gameData.randomHash, gameData.secretKey, winnerIndex)
        .accountsPartial({
          oracleOperator: oracle.operator,
          winner: winner.player.publicKey,
          creator: creator.player.publicKey,
          winnerTokenAccount: wrongAccountOwner.playerTokenAccount.address,
        })
        .signers([oracle.operatorKeypair])
        .rpc();
      expect.fail("Should reject mismatched winner token account");
    } catch (e: any) {
      const errorCode = getErrorCode(e);
      const msg = getErrorMessage(e);
      const tokenOwnerError = errorCode === "ConstraintTokenOwner";
      const associatedAccountError =
        errorCode === "ConstraintAssociatedTokenAccount";
      expect(
        tokenOwnerError ||
          associatedAccountError ||
          msg.includes("ConstraintTokenOwner") ||
          msg.includes("ConstraintAssociatedTokenAccount") ||
          msg.includes("winnerTokenAccount")
      ).to.be.true;
    }
  });

  it("should fail with GameNotReadyForOracle until game reaches completion conditions", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;
    const gameData = testUtils.game.generateGamePDA();

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    try {
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );
      expect.fail("Should throw GameNotReadyForOracle");
    } catch (e: any) {
      expectAnchorError(e, "GameNotReadyForOracle", "Game not ready for oracle");
    }
  });

  it("should complete successfully and distribute winnings when inputs are consistent", async () => {
    const { oracle, mint, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner, pot } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const { fee: expectedFee, winnerAmount: expectedWinnerAmount } =
      calculatePayoutBreakdown(pot, oracle.config.feePercentage);

    const preWinnerBalance = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );
    const winnerBefore = new anchor.BN(preWinnerBalance.value.amount);

    const gameTokenBefore = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    const feeBefore = new anchor.BN(gameTokenBefore.feeAmount.toString());

    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    const postWinnerBalance = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );
    const winnerAfter = new anchor.BN(postWinnerBalance.value.amount);
    expect(winnerAfter.sub(winnerBefore).eq(expectedWinnerAmount)).to.be.true;

    const gameTokenAfter = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    const feeAfter = new anchor.BN(gameTokenAfter.feeAmount.toString());
    expect(feeAfter.sub(feeBefore).eq(expectedFee)).to.be.true;

    const closedAccountInfo = await env.provider.connection.getAccountInfo(
      gameData.gamePDA
    );
    expect(closedAccountInfo).to.be.null;
  });

  it("should emit GameCompleted event with expected payload", async () => {
    const { oracle, mint, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { gameAccount, winnerIndex, winner, pot } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const { fee: expectedFee, winnerAmount: expectedWinnerAmount } =
      calculatePayoutBreakdown(pot, oracle.config.feePercentage);

    let resolveEvent: ((event: any) => void) | undefined;
    let rejectEvent: ((error: Error) => void) | undefined;
    const eventPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Event not emitted")), 5000);
      resolveEvent = (event: any) => {
        clearTimeout(timeout);
        resolve(event);
      };
      rejectEvent = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });

    const listener = await env.program.addEventListener(
      "gameCompleted",
      (event) => resolveEvent?.(event)
    );

    let emittedEvent: any;
    try {
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );
      emittedEvent = await eventPromise;
    } catch (err) {
      rejectEvent?.(err as Error);
      throw err;
    } finally {
      await env.program.removeEventListener(listener);
    }

    expect(emittedEvent.gameKey.toBase58()).to.equal(gameData.gamePDA.toBase58());
    expect(emittedEvent.winner.toBase58()).to.equal(
      winner.player.publicKey.toBase58()
    );
    expect(emittedEvent.ticketsCount).to.equal(gameAccount.ticketsCount);
    expect(
      new anchor.BN(emittedEvent.winnerAmount.toString()).eq(expectedWinnerAmount)
    ).to.be.true;
    expect(new anchor.BN(emittedEvent.feeAmount.toString()).eq(expectedFee)).to.be.true;
    expect(
      new anchor.BN(emittedEvent.timestamp.toString()).gte(
        new anchor.BN(gameAccount.createdAt.toString())
      )
    ).to.be.true;

    const gameTokenAccount = await env.program.account.gameToken.fetch(mint.gameTokenPDA);
    expect(new anchor.BN(gameTokenAccount.feeAmount.toString()).eq(expectedFee)).to.be.true;
  });
});
