import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { createHash } from "crypto";
import {
  TestEnvironment,
  TestUtils,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  getErrorMessage,
  toNumber,
  deriveGameAccounts,
  toGameTokenContext,
  subscribeEvent,
  awaitBufferExpiry,
  coinflipGameConfig,
  getOraclePublicKey,
  ensureOperatorAta,
} from "./test-helpers";

// Instruction coverage: ensure lifecycle events emit and state updates match expectations

describe("Game Lifecycle Instruction Events", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  const unjoinWithRetry = async (
    gamePDA: anchor.web3.PublicKey,
    player: anchor.web3.Keypair,
    gameAccount: any,
    oracleConfig: any
  ): Promise<void> => {
    const maxAttempts = 12;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const slackSeconds = 3 + attempt;
      await awaitBufferExpiry(gameAccount, oracleConfig, slackSeconds);

      try {
        await testUtils.game.unjoinGame(gamePDA, player);
        return;
      } catch (error) {
        const message = getErrorMessage(error);
        const isBufferError = message.includes("Oracle buffer active");

        if (!isBufferError) {
          console.error(
            `[PlayerUnjoined] unjoin failed (attempt ${
              attempt + 1
            }/${maxAttempts})`,
            message,
            (error as any)?.error?.errorLogs ?? []
          );
          throw error;
        }

        console.warn(
          `[PlayerUnjoined] buffer not expired yet after waiting ${slackSeconds}s, retrying...`
        );

        if (attempt === maxAttempts - 1) {
          throw new Error(
            `Oracle buffer still active after waiting ${slackSeconds} seconds past readyAt (${message}).`
          );
        }
      }
    }
  };

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("should emit GameInitialized with matching configuration", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg = coinflipGameConfig({
      amount: new anchor.BN(2_500_000),
      maxTickets: 3,
      minTickets: 2,
      timeout: 1800,
    });

    const subscription = await subscribeEvent(env.program, "gameInitialized");
    try {
      await testUtils.game.initializeGame(
        gameData,
        cfg,
        creator.player,
        mint.mint
      );

      const event = await subscription.wait;
      expect(event.gameKey).to.deep.equal(gameData.gamePDA);
      expect(event.creator).to.deep.equal(creator.player.publicKey);
      expect(Number(event.ticketAmount)).to.equal(toNumber(cfg.amount));
      expect(event.maxTickets).to.equal(toNumber(cfg.maxTickets));
      expect(event.minTickets).to.equal(toNumber(cfg.minTickets));
      expect(event.isPrivate).to.equal(false);

      const account = await env.program.account.game.fetch(gameData.gamePDA);
      expect(account.creator.equals(creator.player.publicKey)).to.be.true;
      expect(account.ticketAmount.toNumber()).to.equal(toNumber(cfg.amount));
      expect(account.maxTickets).to.equal(toNumber(cfg.maxTickets));
      expect(account.minTickets).to.equal(toNumber(cfg.minTickets));
      expect(account.timeout.toNumber()).to.equal(toNumber(cfg.timeout));
      expect(account.ticketsCount).to.equal(0);
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should emit PlayerJoined and append participant hash", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator, joiner] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg = coinflipGameConfig({
      maxTickets: 3,
      minTickets: 2,
      timeout: 900,
    });

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );

    const subscription = await subscribeEvent(env.program, "playerJoined");
    try {
      await testUtils.game.joinGame(gameData.gamePDA, joiner.player);

      const event = await subscription.wait;
      expect(event.gameKey).to.deep.equal(gameData.gamePDA);
      expect(event.player).to.deep.equal(joiner.player.publicKey);
      expect(event.ticketsCount).to.equal(1);
      expect(event.ticketIndex).to.equal(0);

      const account = await env.program.account.game.fetch(gameData.gamePDA);
      expect(account.ticketsCount).to.equal(1);
      expect(account.totalAmount.toNumber()).to.equal(toNumber(cfg.amount));

      const participantDigest = createHash("sha256")
        .update("timba:part:v1")
        .update(gameData.gamePDA.toBuffer())
        .update(joiner.player.publicKey.toBuffer())
        .digest();
      const expectedHash = participantDigest.subarray(0, 8).readBigUInt64LE(0);
      expect(account.participantHashes.length).to.equal(1);
      const onChainHash = BigInt(account.participantHashes[0].toString());
      expect(onChainHash).to.equal(expectedHash);
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should emit PlayerUnjoined and reduce totals", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, p1] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg = coinflipGameConfig({
      amount: new anchor.BN(2_000_000),
      maxTickets: 3,
      minTickets: 2,
      timeout: 10,
    });

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);

    const subscription = await subscribeEvent(env.program, "playerUnjoined", {
      timeoutMs: 20_000,
    });
    try {
      await unjoinWithRetry(
        gameData.gamePDA,
        p1.player,
        gameAccount,
        oracle.config
      );

      const event = await subscription.wait;
      expect(event.player).to.deep.equal(p1.player.publicKey);
      expect(event.ticketsCount).to.equal(0);
      expect(Number(event.totalAmount)).to.equal(0);

      const account = await env.program.account.game.fetch(gameData.gamePDA);
      expect(account.ticketsCount).to.equal(0);
      expect(account.totalAmount.toNumber()).to.equal(0);
    } catch (err) {
      console.error(
        "[PlayerUnjoined] test failed",
        getErrorMessage(err),
        (err as any)?.error?.errorLogs ?? []
      );
      throw err;
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should emit GameCompleted with correct fee accounting", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, p1] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg = coinflipGameConfig({
      amount: new anchor.BN(5_000_000),
      timeout: 600,
    });

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, p1], winnerIndex);

    const subscription = await subscribeEvent(env.program, "gameCompleted");
    try {
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      const event = await subscription.wait;
      expect(event.gameKey).to.deep.equal(gameData.gamePDA);
      expect(event.winner).to.deep.equal(winner.player.publicKey);

      const totalAmount = toNumber(cfg.amount) * 2;
      const fee = Math.floor((totalAmount * oracle.config.feePercentage) / 100);
      const expectedWinnerAmount = totalAmount - fee;

      expect(Number(event.feeAmount)).to.equal(fee);
      expect(Number(event.winnerAmount)).to.equal(expectedWinnerAmount);

      const tokenAccount = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(tokenAccount.feeAmount.toNumber()).to.equal(fee);

      try {
        await env.program.account.game.fetch(gameData.gamePDA);
        expect.fail("Expected game account to be closed after completion");
      } catch (fetchErr: any) {
        expect(fetchErr.toString()).to.include("Account does not exist");
      }
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should emit GameClosed when creator closes empty game", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg = coinflipGameConfig({
      maxTickets: 4,
      minTickets: 2,
      timeout: 1800,
    });

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );

    const subscription = await subscribeEvent(env.program, "gameClosed");
    try {
      const oraclePubkey = env.oracle?.oracle ?? env.oracle?.oraclePDA;
      if (!oraclePubkey) {
        throw new Error("Oracle not initialized for closeGame event test");
      }

      const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
        player: creator.player.publicKey,
        tokenMint: mint.mint,
      });
      if (!derived.playerTokenAccount) {
        throw new Error(
          "Missing creator token account for closeGame event test"
        );
      }

      await env.program.methods
        .closeGame()
        .accountsStrict({
          game: gameData.gamePDA,
          creator: creator.player.publicKey,
          oracle: oraclePubkey,
          gameTokenCtx: toGameTokenContext(derived),
          creatorTokenAccount: derived.playerTokenAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([creator.player])
        .rpc();

      const event = await subscription.wait;
      expect(event.gameKey).to.deep.equal(gameData.gamePDA);

      try {
        await env.program.account.game.fetch(gameData.gamePDA);
        expect.fail("Expected game account to be closed after close_game");
      } catch (fetchErr: any) {
        expect(fetchErr.toString()).to.include("Account does not exist");
      }
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should emit TokenFeeWithdrawn on withdraw_token_fee", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, p1] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg = coinflipGameConfig({
      amount: new anchor.BN(3_000_000),
      timeout: 600,
    });

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, p1], winnerIndex);

    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    const gameTokenBefore = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    const feeToWithdraw = gameTokenBefore.feeAmount.toNumber();
    expect(feeToWithdraw).to.be.greaterThan(0);

    const connection = env.provider.connection;
    const airdropSig = await connection.requestAirdrop(
      oracle.operator,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    const operatorAta = await ensureOperatorAta(
      connection,
      oracle,
      mint.mint
    );

    const subscription = await subscribeEvent(env.program, "tokenFeeWithdrawn");
    try {
      const oraclePubkey = getOraclePublicKey(oracle);

      const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
        tokenMint: mint.mint,
      });

      await env.program.methods
        .withdrawTokenFee()
        .accountsStrict({
          gameTokenCtx: toGameTokenContext(derived),
          oracle: oraclePubkey,
          oracleOperator: oracle.operator,
          oracleOperatorTokenAccount: operatorAta,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([oracle.operatorKeypair])
        .rpc();

      const event = await subscription.wait;
      expect(event.tokenMint).to.deep.equal(mint.mint);
      expect(Number(event.amount)).to.equal(feeToWithdraw);

      const gameTokenAfter = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(gameTokenAfter.feeAmount.toNumber()).to.equal(0);
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });
});
