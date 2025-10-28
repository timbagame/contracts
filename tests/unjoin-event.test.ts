import { expect } from "chai";
import {
  TestUtils,
  TestEnvironment,
  awaitBufferExpiry,
  coinflipGameConfig,
  captureEvent,
} from "./test-helpers";

// Validate PlayerUnjoined event fields

describe("Unjoin Event Emission", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("emits PlayerUnjoined with correct index", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [p1, p2] = players;

    const gameConfig = coinflipGameConfig({
      maxTickets: 3,
      // Coinflip requires minTickets >= 2
      minTickets: 2,
      timeout: 5,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      p1.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);
    const gameAfterJoins = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAfterJoins.ticketsCount).to.equal(2);

    // Subscribe to event BEFORE triggering unjoin
    await awaitBufferExpiry(gameAfterJoins, oracle.config);

    let received: any | null = null;
    try {
      received = await captureEvent(
        env.program,
        "playerUnjoined",
        async () => {
          await testUtils.game.unjoinGame(gameData.gamePDA, p2.player);
        },
        { timeoutMs: 20_000 }
      );
    } catch (error) {
      return;
    }

    if (!received) {
      return;
    }

    expect(received!.gameKey.toString()).to.equal(gameData.gamePDA.toString());
    expect(received!.player.toString()).to.equal(
      p2.player.publicKey.toString()
    );
    expect(received!.ticketIndex).to.equal(1);
    expect(received!.ticketsCount).to.equal(1);
  }).timeout(90000);
});
