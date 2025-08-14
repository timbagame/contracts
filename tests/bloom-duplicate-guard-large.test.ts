import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Ensure duplicate guard works with larger bloom and multiple joins

describe("Bloom Duplicate Guard (Large)", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("prevents duplicate join and allows many unique joins", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const creator = players[0];

    // Use larger max to exercise bloom distribution
    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(256),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);

    // First join should pass
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    // Duplicate join should fail with AlreadyJoined
    try {
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      expect.fail("Expected duplicate join to fail");
    } catch (e: any) {
      expect(e.toString()).to.include("AlreadyJoined");
    }

    // Have many other players join; ensure no spurious blocks
    // Reuse pool players where available
    let successful = 0;
    for (let i = 1; i < Math.min(players.length, 50); i++) {
      try {
        await testUtils.game.joinGame(gameData.gamePDA, players[i]!.player);
        successful++;
      } catch (e) {
        // Should not fail for unique players given capacity
        expect.fail(`Unique join failed for player ${i}: ${e}`);
      }
    }

    // Verify ticket count matches
    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    expect(Number(gameAccount.ticketsCount)).to.equal(1 + successful);
  }).timeout(90000);
});

