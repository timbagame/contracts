import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

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

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: shortTimeout,
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    // Attempt unjoin before timeout+buffer
    try {
      await testUtils.game.unjoinGame(gameData.gamePDA, creator.player, 0);
      expect.fail("Should have failed before buffer expiry");
    } catch (e) {
      expect(e.toString()).to.include("OracleBufferNotExpired");
    }

    // Fast-forward time by manipulating Clock via sleep to exceed timeout + buffer
    const bufferSecs = (typeof oracle.config.oracleBufferTime === 'number' ? oracle.config.oracleBufferTime : oracle.config.oracleBufferTime);
    const shortTimeoutSecs = (typeof shortTimeout === 'number' ? shortTimeout : shortTimeout.toNumber());
    const waitMs = (shortTimeoutSecs + bufferSecs + 2) * 1000; // extra 2s margin
    await new Promise((r) => setTimeout(r, waitMs));

    // Now unjoin should succeed
    await testUtils.game.unjoinGame(gameData.gamePDA, creator.player, 0);
    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(0);
  }).timeout(60000);
});
