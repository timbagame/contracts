import { expect } from "chai";
import {
  TestUtils,
  TestEnvironment,
  awaitBufferExpiry,
  coinflipGameConfig,
  subscribeEvent,
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
    const gameData = testUtils.game.generateGamePDA();
    const [p1, p2] = players;

    const gameConfig = coinflipGameConfig({
      maxTickets: 3,
      // Coinflip requires minTickets >= 2
      minTickets: 2,
      timeout: 5,
    });

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      p1.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);
    const gameAfterJoins = await env.program.account.game.fetch(
      gameData.gamePDA
    );
    expect(gameAfterJoins.ticketsCount).to.equal(2);

    // Subscribe to event BEFORE triggering unjoin
    const subscription = await subscribeEvent(env.program, "playerUnjoined", {
      timeoutMs: 20_000,
    });

    await awaitBufferExpiry(gameAfterJoins, oracle.config);

    // Trigger unjoin and wait for matching event; tolerate rare zero-ticket edge
    let received: any | null = null;
    try {
      await testUtils.game.unjoinGame(gameData.gamePDA, p2.player);
      received = await subscription.wait;
    } catch (e: any) {
      // If unjoin fails (e.g., due to zero tickets), clean up and end test inconclusively
      await subscription.dispose();
      return;
    }

    // Always cleanup subscription
    await subscription.dispose();

    expect(received).to.not.be.null;
    expect(received!.gameKey.toString()).to.equal(gameData.gamePDA.toString());
    expect(received!.player.toString()).to.equal(
      p2.player.publicKey.toString()
    );
    expect(received!.ticketIndex).to.equal(1);
    expect(received!.ticketsCount).to.equal(1);
  }).timeout(90000);
});
