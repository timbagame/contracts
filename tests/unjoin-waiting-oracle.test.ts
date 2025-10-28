import { expect } from "chai";
import {
  TestUtils,
  TestEnvironment,
  awaitBufferExpiry,
  coinflipGameConfig,
} from "./test-helpers";

// Ensure unjoin is blocked during waiting_for_oracle window (min reached, before buffer expiry)

describe("Unjoin Blocked While Waiting for Oracle", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should reject unjoin before buffer when min tickets reached", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [p1, p2] = players;

    const gameConfig = coinflipGameConfig({
      timeout: 3,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      p1.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);

    // Game is now either full or at min; before buffer expires, unjoin should be blocked
    await testUtils.game
      .unjoinGame(gameData.gamePDA, p1.player)
      .then(() => expect.fail("Should have failed before buffer expiry"))
      .catch((e) => {
        expect(e.toString()).to.include("OracleBufferNotExpired");
      });

    // sanity: wait until after timeout+buffer then unjoin succeeds
    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    await awaitBufferExpiry(gameAccount, oracle.config);
    await testUtils.game.unjoinGame(gameData.gamePDA, p1.player);
    const acc = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(acc.ticketsCount).to.equal(1);
  }).timeout(60000);
});
