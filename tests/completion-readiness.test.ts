import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

// Ensures GameNotReadyForOracle triggers when completion attempted too early

describe("Completion Readiness Guard", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should reject completion before game is ready", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, p1] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(4),
      minTickets: new anchor.BN(3),
      timeout: new anchor.BN(30),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, creator.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    // Only 2 tickets joined, minTickets=3 => not ready.
    // Attempt completion (should fail GameNotReadyForOracle)
    try {
      await testUtils.game.completeGame(
        gameData,
        creator.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        0
      );
      expect.fail("Should have failed readiness guard");
    } catch (e: any) {
      expect(e.toString()).to.include("Game not ready for oracle");
    }
  });
});
