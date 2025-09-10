import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

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

    // Record creator pre-balance
    const preBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);

    const gameBefore = await env.program.account.game.fetch(gameData.gamePDA);
    expect(gameBefore.ticketAmount.toNumber()).to.equal(0);
    expect(gameBefore.totalAmount.toNumber()).to.equal(prize.toNumber());

    // Wait until buffer expiry then unjoin one participant
    await new Promise((r) => setTimeout(r, (5 + (oracle.config.oracleBufferTime as number) + 2) * 1000));
    await testUtils.game.unjoinGame(gameData.gamePDA, p1.player);

    const gameAfterUnjoin = await env.program.account.game.fetch(gameData.gamePDA);
    expect(gameAfterUnjoin.ticketsCount).to.equal(1);
    expect(gameAfterUnjoin.totalAmount.toNumber()).to.equal(prize.toNumber());

    // Creator closes game and gets full refund
    await env.program.methods
      .closeGame()
      .accounts({
        game: gameData.gamePDA,
        creator: creator.player.publicKey,
      })
      .signers([creator.player])
      .rpc();

    const postBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );
    const delta = new anchor.BN(postBal.value.amount).sub(new anchor.BN(preBal.value.amount));
    expect(delta.eq(prize)).to.be.true;
  }).timeout(90000);
});

