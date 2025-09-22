import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { createHash } from "crypto";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import type { Coinflip } from "../target/types/coinflip";
import { TestEnvironment, TestUtils, GameConfig, calculateWinnerIndex, getWinnerFromPlayers } from "./test-helpers";

// Instruction coverage: ensure lifecycle events emit and state updates match expectations

const toNumber = (value: anchor.BN | number): number =>
  typeof value === "number" ? value : value.toNumber();

type CoinflipEvents = anchor.IdlEvents<Coinflip>;
type CoinflipEventName = keyof CoinflipEvents;

describe("Game Lifecycle Instruction Events", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  const subscribeEvent = async <TEvent extends CoinflipEventName>(eventName: TEvent) => {
    let listenerId: number | undefined;
    let settled = false;
    let resolveEvent: (value: CoinflipEvents[TEvent]) => void;
    let rejectEvent: (reason?: unknown) => void;

    const wait = new Promise<CoinflipEvents[TEvent]>((resolve, reject) => {
      resolveEvent = resolve;
      rejectEvent = reject;
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectEvent(new Error(`${eventName} timeout`));
      }
    }, 10000);

    listenerId = await env.program.addEventListener(eventName, (event: CoinflipEvents[TEvent]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveEvent(event);
    });

    const dispose = async () => {
      clearTimeout(timer);
      if (listenerId !== undefined) {
        await env.program.removeEventListener(listenerId);
      }
    };

    wait.catch(async () => {
      await dispose().catch(() => {});
    });

    return { wait, dispose };
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
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(2_500_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(1800),
      isPrivate: false,
    };

    const subscription = await subscribeEvent("gameInitialized");
    try {
      await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);

      const event = await subscription.wait;
      expect(event.gameKey).to.deep.equal(gameData.gamePDA);
      expect(event.creator).to.deep.equal(creator.player.publicKey);
      expect(Number(event.ticketAmount)).to.equal(cfg.amount.toNumber());
      expect(event.maxTickets).to.equal(toNumber(cfg.maxTickets));
      expect(event.minTickets).to.equal(toNumber(cfg.minTickets));
      expect(event.isPrivate).to.equal(false);

      const account = await env.program.account.game.fetch(gameData.gamePDA);
      expect(account.creator.equals(creator.player.publicKey)).to.be.true;
      expect(account.ticketAmount.toNumber()).to.equal(cfg.amount.toNumber());
      expect(account.maxTickets).to.equal(toNumber(cfg.maxTickets));
      expect(account.minTickets).to.equal(toNumber(cfg.minTickets));
      expect(account.timeout.toNumber()).to.equal(cfg.timeout.toNumber());
      expect(account.ticketsCount).to.equal(0);
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should emit PlayerJoined and append participant hash", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator, joiner] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(900),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);

    const subscription = await subscribeEvent("playerJoined");
    try {
      await testUtils.game.joinGame(gameData.gamePDA, joiner.player);

      const event = await subscription.wait;
      expect(event.gameKey).to.deep.equal(gameData.gamePDA);
      expect(event.player).to.deep.equal(joiner.player.publicKey);
      expect(event.ticketsCount).to.equal(1);
      expect(event.ticketIndex).to.equal(0);

      const account = await env.program.account.game.fetch(gameData.gamePDA);
      expect(account.ticketsCount).to.equal(1);
      expect(account.totalAmount.toNumber()).to.equal(cfg.amount.toNumber());

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
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(2_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(1),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const waitSeconds = cfg.timeout.toNumber() + oracle.config.oracleBufferTime + 4;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));

    const subscription = await subscribeEvent("playerUnjoined");
    try {
      await testUtils.game.unjoinGame(gameData.gamePDA, p1.player);

      const event = await subscription.wait;
      expect(event.player).to.deep.equal(p1.player.publicKey);
      expect(event.ticketsCount).to.equal(0);
      expect(Number(event.totalAmount)).to.equal(0);

      const account = await env.program.account.game.fetch(gameData.gamePDA);
      expect(account.ticketsCount).to.equal(0);
      expect(account.totalAmount.toNumber()).to.equal(0);
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should emit GameCompleted with correct fee accounting", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, p1] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(5_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, p1], winnerIndex);

    const subscription = await subscribeEvent("gameCompleted");
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

      const totalAmount = cfg.amount.toNumber() * 2;
      const fee = Math.floor((totalAmount * oracle.config.feePercentage) / 100);
      const expectedWinnerAmount = totalAmount - fee;

      expect(Number(event.feeAmount)).to.equal(fee);
      expect(Number(event.winnerAmount)).to.equal(expectedWinnerAmount);

      const tokenAccount = await env.program.account.gameToken.fetch(mint.gameTokenPDA);
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
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(4),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(1800),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);

    const subscription = await subscribeEvent("gameClosed");
    try {
      await env.program.methods
        .closeGame()
        .accounts({ creator: creator.player.publicKey, game: gameData.gamePDA })
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
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(3_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);
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

    const gameTokenBefore = await env.program.account.gameToken.fetch(mint.gameTokenPDA);
    const feeToWithdraw = gameTokenBefore.feeAmount.toNumber();
    expect(feeToWithdraw).to.be.greaterThan(0);

    const connection = env.provider.connection;
    const airdropSig = await connection.requestAirdrop(
      oracle.operator,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    await getOrCreateAssociatedTokenAccount(
      connection,
      oracle.operatorKeypair,
      mint.mint,
      oracle.operator
    );

    const subscription = await subscribeEvent("tokenFeeWithdrawn");
    try {
      await env.program.methods
        .withdrawTokenFee()
        .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
        .signers([oracle.operatorKeypair])
        .rpc();

      const event = await subscription.wait;
      expect(event.tokenMint).to.deep.equal(mint.mint);
      expect(Number(event.amount)).to.equal(feeToWithdraw);

      const gameTokenAfter = await env.program.account.gameToken.fetch(mint.gameTokenPDA);
      expect(gameTokenAfter.feeAmount.toNumber()).to.equal(0);
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });
});
