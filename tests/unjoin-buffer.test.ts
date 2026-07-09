import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import {
  TestUtils,
  TestEnvironment,
  awaitBufferExpiry,
  coinflipGameConfig,
  expectAnchorError,
} from "./test-helpers";

// Test game timeouts are configured in seconds.
const SHORT_TIMEOUT_SECONDS = 5;
const TEST_TIMEOUT_MS = 60000;

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

    const shortTimeout = new anchor.BN(SHORT_TIMEOUT_SECONDS);

    const gameConfig = coinflipGameConfig({
      timeout: shortTimeout,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    // This succeeds before timeout+buffer because the game is underfilled, so it
    // is not waiting for oracle completion. For completion-ready games, unjoin is
    // blocked until timeout + oracle buffer has elapsed.
    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
    let updatedGameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(updatedGameAccount.ticketsCount).to.equal(0);

    // Rejoin so we can confirm the post-buffer path still works as expected
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    // Fast-forward time by manipulating Clock via sleep to exceed timeout + buffer
    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    await awaitBufferExpiry(gameAccount, oracle.config);

    // Now unjoin should succeed
    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
    updatedGameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(updatedGameAccount.ticketsCount).to.equal(0);
  }).timeout(TEST_TIMEOUT_MS);

  it("should reject unjoin before buffer for a full game, then allow sequential unjoins after buffer", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, secondPlayer] = players;

    const shortTimeout = new anchor.BN(SHORT_TIMEOUT_SECONDS);

    const gameConfig = coinflipGameConfig({
      timeout: shortTimeout,
      minTickets: 2,
      maxTickets: 2,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, secondPlayer.player);

    await expectAnchorError(
      testUtils.game.unjoinGame(gameData.gamePDA, creator.player),
      "OracleBufferNotExpired",
      {
        fallbackSubstring: "OracleBufferNotExpired",
        message: "Full game should block unjoin before timeout + buffer",
      }
    );

    let gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(2);

    await awaitBufferExpiry(gameAccount, oracle.config);

    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
    gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(1);

    await testUtils.game.unjoinGame(gameData.gamePDA, secondPlayer.player);
    gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(0);
  }).timeout(TEST_TIMEOUT_MS);

  it("should allow one player to unjoin before buffer in underfilled state and another after buffer", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, secondPlayer] = players;

    const shortTimeout = new anchor.BN(SHORT_TIMEOUT_SECONDS);

    const gameConfig = coinflipGameConfig({
      timeout: shortTimeout,
      minTickets: 3,
      maxTickets: 3,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, secondPlayer.player);

    // Underfilled (2 < min 3), so early unjoin is allowed.
    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
    let gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(1);

    await awaitBufferExpiry(gameAccount, oracle.config);

    await testUtils.game.unjoinGame(gameData.gamePDA, secondPlayer.player);
    gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(0);
  }).timeout(TEST_TIMEOUT_MS);
});
