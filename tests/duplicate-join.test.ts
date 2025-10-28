import {
  TestUtils,
  TestEnvironment,
  coinflipGameConfig,
  expectAnchorError,
} from "./test-helpers";

// Tests duplicate join prevention using bloom + hash exact list

describe("Duplicate Join Prevention", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    await env.initialize();
  });

  it("should prevent duplicate join with AlreadyJoined error", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const gameConfig = coinflipGameConfig({
      timeout: 600,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    await expectAnchorError(
      testUtils.game.joinGame(gameData.gamePDA, creator.player),
      "AlreadyJoined",
      {
        fallbackSubstring: "AlreadyJoined",
        message: "Expected duplicate join to fail",
      }
    );
  });
});
