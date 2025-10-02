import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Giveaway-specific configuration guard rails

describe("Giveaway Constraints", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("should reject giveaway initialization when minTickets is below 1", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;
    const gameData = testUtils.game.generateGamePDA();

    const cfg: GameConfig = {
      gameType: { giveaway: {} },
      amount: new anchor.BN(5_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(0),
      timeout: new anchor.BN(600),
      isPrivate: false,
    };

    try {
      await testUtils.game.initializeGame(
        gameData,
        cfg,
        creator.player,
        mint.mint
      );
      expect.fail("Expected giveaway initialize to reject with minTickets < 1");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }
  });

  it("should reject giveaway when prize is smaller than token min amount", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;
    const gameData = testUtils.game.generateGamePDA();

    const belowMinPrize = new anchor.BN(100); // default minAmount is 1000 in mint manager
    const cfg: GameConfig = {
      gameType: { giveaway: {} },
      amount: belowMinPrize,
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(600),
      isPrivate: false,
    };

    try {
      await testUtils.game.initializeGame(
        gameData,
        cfg,
        creator.player,
        mint.mint
      );
      expect.fail("Expected giveaway initialize to enforce token min amount");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidAmount");
    }
  });
});
