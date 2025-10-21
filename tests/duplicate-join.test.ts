import { expect } from "chai";
import {
  TestUtils,
  TestEnvironment,
  errorToString,
  coinflipGameConfig,
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
    const gameData = testUtils.game.generateGamePDA();
    const [creator] = players;

    const gameConfig = coinflipGameConfig({
      timeout: 600,
    });

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    try {
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      expect.fail("Expected duplicate join to fail");
    } catch (e: unknown) {
      expect(errorToString(e)).to.include("AlreadyJoined");
    }
  });
});
