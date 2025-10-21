import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  deriveGameAccounts,
  toGameTokenContext,
} from "./test-helpers";

// Giveaway: unjoin affects tickets_count but not total_amount; closing refunds full prize

describe("Giveaway Unjoin and Close", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("unjoin does not change prize; close refunds creator fully", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, p1, p2] = players;

    const prize = new anchor.BN(5_000_000);

    const gameConfig: GameConfig = {
      gameType: { giveaway: {} },
      amount: prize,
      maxTickets: new anchor.BN(5),
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(5),
      isPrivate: false,
    };

    // Record creator balance before funding (pre)
    const beforeBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);

    const gameBefore = await env.program.account.game.fetch(gameData.gamePDA);
    expect(gameBefore.ticketAmount.toNumber()).to.equal(0);
    expect(gameBefore.totalAmount.toNumber()).to.equal(prize.toNumber());

    // Wait until buffer expiry then unjoin all participants to allow close
    await new Promise((r) =>
      setTimeout(r, (5 + (oracle.config.oracleBufferTime as number) + 2) * 1000)
    );
    await testUtils.game.unjoinGame(gameData.gamePDA, p1.player);
    await testUtils.game.unjoinGame(gameData.gamePDA, p2.player);

    const gameAfterUnjoins = await env.program.account.game.fetch(
      gameData.gamePDA
    );
    expect(gameAfterUnjoins.ticketsCount).to.equal(0);
    expect(gameAfterUnjoins.totalAmount.toNumber()).to.equal(prize.toNumber());

    const oraclePubkey = oracle.oracle ?? oracle.oraclePDA;
    if (!oraclePubkey) {
      throw new Error("Oracle not initialized for giveaway unjoin test");
    }

    const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
      player: creator.player.publicKey,
    });
    if (!derived.playerTokenAccount) {
      throw new Error("Missing creator token account for giveaway unjoin test");
    }

    // Creator closes game and gets full refund
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

    const afterBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );
    // After lifecycle (fund then close), balance returns to original
    expect(
      new anchor.BN(afterBal.value.amount).eq(
        new anchor.BN(beforeBal.value.amount)
      )
    ).to.be.true;
  }).timeout(90000);
});
