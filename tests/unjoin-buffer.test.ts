import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  awaitBufferExpiry,
  coinflipGameConfig,
  expectAnchorError,
} from "./test-helpers";

// Tests unjoin behavior relative to oracle buffer expiration

describe("Unjoin After Buffer", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    await env.initialize();
  });

  it("should block unjoin before buffer and allow after buffer", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator] = players;

    const shortTimeout = new anchor.BN(5); // very short timeout

    const gameConfig = coinflipGameConfig({
      timeout: shortTimeout,
    });

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    // Attempt unjoin before timeout+buffer
    await expectAnchorError(
      testUtils.game.unjoinGame(gameData.gamePDA, creator.player),
      "OracleBufferNotExpired",
      {
        fallbackSubstring: "OracleBufferNotExpired",
        message: "Should have failed before buffer expiry",
      }
    );

    // Fast-forward time by manipulating Clock via sleep to exceed timeout + buffer
    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    await awaitBufferExpiry(gameAccount, oracle.config);

    // Now unjoin should succeed
    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
    const updatedGameAccount = await env.program.account.game.fetch(
      gameData.gamePDA
    );
    expect(updatedGameAccount.ticketsCount).to.equal(0);
  }).timeout(60000);
});
