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
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(5),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, p1.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);

    // Capture event
    let received: any | null = null;
    const sub = await env.program.addEventListener("playerUnjoined", (ev: any) => {
      received = ev;
    });

    await new Promise((r) => setTimeout(r, (5 + (oracle.config.oracleBufferTime as number) + 2) * 1000));

    // Unjoin second player; expect index 1
    await testUtils.game.unjoinGame(gameData.gamePDA, p2.player);

    // Give some time for event to be processed
    await new Promise((r) => setTimeout(r, 500));
    await env.program.removeEventListener(sub);

    expect(received).to.not.be.null;
    expect(received!.gameKey.toString()).to.equal(gameData.gamePDA.toString());
    expect(received!.player.toString()).to.equal(p2.player.publicKey.toString());
    expect(received!.ticketIndex).to.equal(1);
    expect(received!.ticketsCount).to.equal(1);
  }).timeout(90000);
});
