import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

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
    const gameData = testUtils.game.generateGamePDA();
    const [p1, p2] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, gameConfig, p1.player, mint.mint);
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
    await new Promise((r) => setTimeout(r, (3 + (oracle.config.oracleBufferTime as number) + 2) * 1000));
    await testUtils.game.unjoinGame(gameData.gamePDA, p1.player);
    const acc = await env.program.account.game.fetch(gameData.gamePDA);
    expect(acc.ticketsCount).to.equal(1);
  }).timeout(60000);
});
