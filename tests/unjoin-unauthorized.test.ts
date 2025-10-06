import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  errorToString,
} from "./test-helpers";

// Negative scenarios around unjoin authorization

describe("Unjoin Unauthorized Scenarios", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should reject unjoin by non-participant with UnauthorizedPlayer", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [p1, p2] = players;

    const config: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(5),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(gameData, config, p1.player, mint.mint);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    // Wait until timeout + buffer so unjoin is eligible if authorized
    await new Promise((r) =>
      setTimeout(r, (5 + (oracle.config.oracleBufferTime as number) + 2) * 1000)
    );

    // p2 never joined; should fail with UnauthorizedPlayer
    try {
      await testUtils.game.unjoinGame(gameData.gamePDA, p2.player);
      expect.fail("Expected UnauthorizedPlayer for non-participant unjoin");
    } catch (e: unknown) {
      expect(errorToString(e)).to.include("UnauthorizedPlayer");
    }

    const g = await env.program.account.game.fetch(gameData.gamePDA);
    expect(g.ticketsCount).to.equal(1);
  }).timeout(60000);

  it("should reject unjoin when no participants have joined the game", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator] = players;
    const gameData = testUtils.game.generateGamePDA();

    const config: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(1),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      config,
      creator.player,
      mint.mint
    );

    const waitSeconds =
      Number(config.timeout.toNumber()) +
      Number(oracle.config.oracleBufferTime) +
      2;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));

    try {
      await testUtils.game.unjoinGame(gameData.gamePDA, creator.player);
      expect.fail("Expected InvalidTicketsCount when no participants joined");
    } catch (e: unknown) {
      expect(errorToString(e)).to.include("InvalidTicketsCount");
    }

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(0);
  }).timeout(60000);

  // Note: a second unjoin attempt after a successful unjoin will fail,
  // but exact error code may vary depending on current tickets_count/value.
});
