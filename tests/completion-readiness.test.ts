import { expect } from "chai";
import { TestUtils, TestEnvironment, coinflipGameConfig } from "./test-helpers";

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
    const [creator, p1] = players;

    const gameConfig = coinflipGameConfig({
      maxTickets: 4,
      minTickets: 3,
      timeout: 30,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );
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
      expect(e.toString()).to.include("Oracle not ready");
    }
  });
});
