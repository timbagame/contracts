import {
  TestUtils,
  TestEnvironment,
  coinflipGameConfig,
  expectAnchorError,
} from "./test-helpers";

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

    const gameConfig = coinflipGameConfig({
      maxTickets: 3,
      minTickets: 2,
      timeout: 2,
    });

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    // Wait slightly past timeout
    await new Promise((r) => setTimeout(r, 3000));

    await expectAnchorError(
      testUtils.game.joinGame(gameData.gamePDA, p1.player),
      "GameExpired",
      {
        fallbackSubstring: "GameExpired",
        message: "Expected GameExpired when joining after timeout",
      }
    );
  }).timeout(30000);
});
