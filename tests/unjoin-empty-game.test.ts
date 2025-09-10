import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Attempting to unjoin when no tickets exist should return InvalidTicketsCount

describe("Unjoin on Empty Game", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should fail with InvalidTicketsCount when no players joined", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [caller] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(3),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, caller.player, mint.mint);

    // Wait for timeout + buffer
    await new Promise((r) => setTimeout(r, (3 + (oracle.config.oracleBufferTime as number) + 2) * 1000));

    try {
      await testUtils.game.unjoinGame(gameData.gamePDA, caller.player);
      expect.fail("Expected InvalidTicketsCount when unjoining empty game");
    } catch (e) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }
  }).timeout(60000);
});

