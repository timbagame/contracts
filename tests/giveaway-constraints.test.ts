import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, giveawayGameConfig } from "./test-helpers";

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

    const cfg = giveawayGameConfig({
      amount: new anchor.BN(5_000_000),
      maxTickets: 3,
      minTickets: 0,
      timeout: 600,
    });

    try {
      await testUtils.game.createGame(cfg, creator.player, mint.mint);
      expect.fail("Expected giveaway initialize to reject with minTickets < 1");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }
  });

  it("should reject giveaway when prize is smaller than token min amount", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const belowMinPrize = new anchor.BN(100); // default minAmount is 1000 in mint manager
    const cfg = giveawayGameConfig({
      amount: belowMinPrize,
      maxTickets: 2,
      timeout: 600,
    });

    try {
      await testUtils.game.createGame(cfg, creator.player, mint.mint);
      expect.fail("Expected giveaway initialize to enforce token min amount");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidAmount");
    }
  });
});
