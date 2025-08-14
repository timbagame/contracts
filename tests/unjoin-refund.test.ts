import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Precision check for unjoin refund amount

describe("Unjoin Refund Precision", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should refund exactly ticket amount when unjoining after buffer", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, p1] = players;

    const ticketAmount = new anchor.BN(3_333_333); // awkward number for edge

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: ticketAmount,
      maxTickets: new anchor.BN(4),
      minTickets: new anchor.BN(3),
      timeout: new anchor.BN(5),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const preBalance = await env.provider.connection.getTokenAccountBalance(creator.playerTokenAccount.address);

    // Wait until buffer expiry
    const bufferSecs = oracle.config.oracleBufferTime as number;
    await new Promise((r) => setTimeout(r, (5 + bufferSecs + 2) * 1000));

    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player, 0);

    const postBalance = await env.provider.connection.getTokenAccountBalance(creator.playerTokenAccount.address);

    const delta = new anchor.BN(postBalance.value.amount).sub(new anchor.BN(preBalance.value.amount));
    expect(delta.eq(ticketAmount)).to.be.true;
  }).timeout(60000);
});
