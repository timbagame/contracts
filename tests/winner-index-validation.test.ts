import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  computeGameOutcome,
  calculatePayoutBreakdown,
  getErrorCode,
  getErrorMessage,
  coinflipGameConfig,
  expectAnchorError,
  captureEvent,
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
    const [creator, player1] = players;

    const gameConfig = coinflipGameConfig();

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    return { oracle, mint, gameData, creator, player1 };
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

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        wrongIndex
      ),
      "WinnerIndexMismatch",
      { fallbackSubstring: "Winner index mismatch" }
    );
  });

  it("should fail with WinnerPubkeyHashMismatch when winner pubkey does not match stored hash", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const wrongWinner = participants.find(
      (candidate) => !candidate.player.publicKey.equals(winner.player.publicKey)
    );

    if (!wrongWinner) {
      throw new Error("Expected to find a non-winning participant");
    }

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        wrongWinner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      ),
      "WinnerPubkeyHashMismatch",
      { fallbackSubstring: "Winner hash mismatch" }
    );
  });

  it("should fail with WinnerIndexOutOfRange when winner index equals tickets count", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { gameAccount, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const outOfRangeIndex = gameAccount.ticketsCount;

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        outOfRangeIndex
      ),
      "WinnerIndexOutOfRange",
      { fallbackSubstring: "Winner index out of range" }
    );
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

    await expectAnchorError(
      testUtils.game.completeGame(
        { ...gameData, secretKey: tamperedSecret },
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      ),
      "InvalidSecretKey",
      { fallbackSubstring: "Secret key mismatch" }
    );
  });

  it("should reject complete_game when creator account does not match", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const impostorCreator = anchor.web3.Keypair.generate();

    const accounts = await testUtils.game.buildCompleteGameAccounts(
      gameData,
      winner.player.publicKey,
      impostorCreator.publicKey,
      oracle.operator
    );

    await expectAnchorError(
      env.program.methods
        .completeGame(gameData.randomHash, gameData.secretKey, winnerIndex)
        .accountsStrict(accounts)
        .signers([oracle.operatorKeypair])
        .rpc(),
      "InvalidCreator",
      { fallbackSubstring: "Invalid creator" }
    );
  });

  it("should fail when winner token account does not belong to supplied winner", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const wrongAccountOwner = participants.find(
      (candidate) => !candidate.player.publicKey.equals(winner.player.publicKey)
    );

    if (!wrongAccountOwner) {
      throw new Error("Expected a non-winning participant");
    }

    const accounts = await testUtils.game.buildCompleteGameAccounts(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      {
        winnerTokenAccount: wrongAccountOwner.playerTokenAccount.address,
      }
    );

    try {
      await env.program.methods
        .completeGame(gameData.randomHash, gameData.secretKey, winnerIndex)
        .accountsStrict(accounts)
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

    const gameConfig = coinflipGameConfig({
      maxTickets: 3,
    });

    const gameData = await testUtils.game.createGame(
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

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      ),
      "GameNotReadyForOracle",
      { fallbackSubstring: "Oracle not ready" }
    );
  });

  it("should complete successfully and distribute winnings when inputs are consistent", async () => {
    const { oracle, mint, gameData, creator, player1 } =
      await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner, pot } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const { fee: expectedFee, winnerAmount: expectedWinnerAmount } =
      calculatePayoutBreakdown(pot, oracle.config.feePercentage);

    const preWinnerBalance =
      await env.provider.connection.getTokenAccountBalance(
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

    const postWinnerBalance =
      await env.provider.connection.getTokenAccountBalance(
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

  it("should reject completing an already settled game", async () => {
    const { oracle, gameData, creator, player1 } = await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { winnerIndex, winner } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      ),
      "GameAlreadyCompleted",
      { fallbackSubstring: "Game already settled" }
    );
  });

  it("should emit GameCompleted event with expected payload", async () => {
    const { oracle, mint, gameData, creator, player1 } =
      await setupTwoPlayerGame();

    const participants = [creator, player1];
    const { gameAccount, winnerIndex, winner, pot } = await computeGameOutcome(
      env,
      gameData,
      participants
    );

    const { fee: expectedFee, winnerAmount: expectedWinnerAmount } =
      calculatePayoutBreakdown(pot, oracle.config.feePercentage);

    const emittedEvent = await captureEvent(
      env.program,
      "gameCompleted",
      async () => {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          oracle.operator,
          winnerIndex
        );
      }
    );

    expect(emittedEvent.gameKey.toBase58()).to.equal(
      gameData.gamePDA.toBase58()
    );
    expect(emittedEvent.winner.toBase58()).to.equal(
      winner.player.publicKey.toBase58()
    );
    expect(emittedEvent.ticketsCount).to.equal(gameAccount.ticketsCount);
    expect(
      new anchor.BN(emittedEvent.winnerAmount.toString()).eq(
        expectedWinnerAmount
      )
    ).to.be.true;
    expect(new anchor.BN(emittedEvent.feeAmount.toString()).eq(expectedFee)).to
      .be.true;
    expect(
      new anchor.BN(emittedEvent.timestamp.toString()).gte(
        new anchor.BN(gameAccount.createdAt.toString())
      )
    ).to.be.true;

    const gameTokenAccount = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    expect(new anchor.BN(gameTokenAccount.feeAmount.toString()).eq(expectedFee))
      .to.be.true;
  });
});
