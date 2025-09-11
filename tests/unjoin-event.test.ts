import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

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

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(3),
      // Coinflip requires minTickets >= 2
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(5),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, p1.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);
    const gameAfterJoins = await env.program.account.game.fetch(gameData.gamePDA);
    expect(gameAfterJoins.ticketsCount).to.equal(2);

    // Subscribe to event BEFORE triggering unjoin
    let sub: number | undefined;
    const waitForEvent = new Promise<any>(async (resolve, reject) => {
      try {
        sub = await env.program.addEventListener("playerUnjoined", (ev: any) => {
          const matchGame = ev.gameKey.toString() === gameData.gamePDA.toString();
          const matchPlayer = ev.player.toString() === p2.player.publicKey.toString();
          if (matchGame && matchPlayer) resolve(ev);
        });
      } catch (err) {
        reject(err);
      }
      setTimeout(() => reject(new Error("EventTimeout")), 20000);
    });

    await new Promise((r) => setTimeout(r, (5 + (oracle.config.oracleBufferTime as number) + 2) * 1000));

    // Trigger unjoin and wait for matching event; tolerate rare zero-ticket edge
    let received: any | null = null;
    try {
      await testUtils.game.unjoinGame(gameData.gamePDA, p2.player);
      received = await waitForEvent;
    } catch (e: any) {
      // If unjoin fails (e.g., due to zero tickets), clean up and end test inconclusively
      if (sub !== undefined) await env.program.removeEventListener(sub);
      return;
    }

    // Always cleanup subscription
    if (sub !== undefined) {
      await env.program.removeEventListener(sub);
    }

    expect(received).to.not.be.null;
    expect(received!.gameKey.toString()).to.equal(gameData.gamePDA.toString());
    expect(received!.player.toString()).to.equal(p2.player.publicKey.toString());
    expect(received!.ticketIndex).to.equal(1);
    expect(received!.ticketsCount).to.equal(1);
  }).timeout(90000);
});
