import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  awaitBufferExpiry,
  coinflipGameConfig,
} from "./test-helpers";

// Tests unjoin behavior relative to oracle buffer expiration

describe("Unjoin Buffer Behavior", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    await env.initialize();
  });

  it("should allow unjoin before buffer when underfilled and still allow after buffer", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const shortTimeout = new anchor.BN(5); // very short timeout

    const gameConfig = coinflipGameConfig({
      timeout: shortTimeout,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    // Attempt unjoin before timeout+buffer – should succeed because game cannot be completed
    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
    let updatedGameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(updatedGameAccount.ticketsCount).to.equal(0);

    // Rejoin so we can confirm the post-buffer path still works as expected
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    updatedGameAccount = await testUtils.game.fetchGame(gameData.gamePDA);

    // Fast-forward time by manipulating Clock via sleep to exceed timeout + buffer
    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    await awaitBufferExpiry(gameAccount, oracle.config);

    // Now unjoin should succeed
    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
    updatedGameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(updatedGameAccount.ticketsCount).to.equal(0);
  }).timeout(60000);
});
