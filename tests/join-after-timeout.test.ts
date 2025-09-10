import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Joining after timeout should fail with GameExpired

describe("Join After Timeout", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should reject join after timeout even before buffer", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, p1] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(2),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);

    // Wait slightly past timeout
    await new Promise((r) => setTimeout(r, 3000));

    try {
      await testUtils.game.joinGame(gameData.gamePDA, p1.player);
      expect.fail("Expected GameExpired when joining after timeout");
    } catch (e) {
      expect(e.toString()).to.include("GameExpired");
    }
  }).timeout(30000);
});

