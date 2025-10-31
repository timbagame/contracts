import { describe, it, before } from "mocha";
import * as anchor from "@coral-xyz/anchor";
import {
  TestEnvironment,
  TestUtils,
  coinflipGameConfig,
  awaitBufferExpiry,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  expectAnchorError,
} from "./test-helpers";

describe("Complete Game Buffer Expiry", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("rejects completion once the oracle buffer window has elapsed", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;

    const timeoutSeconds = new anchor.BN(5);
    const config = coinflipGameConfig({ timeout: timeoutSeconds });

    const gameData = await testUtils.game.createFilledGame(
      config,
      creator,
      mint.mint,
      [player1]
    );

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);

    await awaitBufferExpiry(gameAccount, oracle.config, 0.25, {
      pollIntervalMs: 500,
    });

    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );
    const winnerPlayer = getWinnerFromPlayers([creator, player1], winnerIndex);

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        winnerPlayer.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      ),
      "GameNotReadyForOracle",
      {
        fallbackSubstring: "Game not ready for oracle",
        message: "Completion should be blocked after buffer expiry",
      }
    );
  }).timeout(120000);
});
