import { describe, expect, test } from "bun:test";
import {
  TestEnvironment,
  TestUtils,
  calculateWinnerIndex,
  coinflipGameConfig,
  expectProgramError,
  fetchTokenBalance,
  getWinnerFromPlayers,
} from "./test-helpers.ts";

describe("Kit TypeScript Client Smoke", () => {
  test("executes a complete coinflip lifecycle through the generated client", async () => {
    const env = TestEnvironment.getInstance();
    const testUtils = new TestUtils();
    await env.initialize();
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, participant] = players;
    const gameData = await testUtils.game.createGame(
      coinflipGameConfig(),
      creator.player,
      mint.mint,
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, participant.player);

    const game = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      game.ticketsCount,
      gameData.secretKey,
      Number(game.lastSlot),
    );
    const winner = getWinnerFromPlayers([creator, participant], winnerIndex);
    const balanceBefore = await fetchTokenBalance(env.rpc, winner.playerTokenAccount);
    await testUtils.game.completeGame(
      gameData,
      winner.player.address,
      creator.player.address,
      oracle.operator,
      winnerIndex,
    );
    const balanceAfter = await fetchTokenBalance(env.rpc, winner.playerTokenAccount);
    expect(balanceAfter > balanceBefore).toBe(true);
    await expectProgramError(testUtils.game.fetchGame(gameData.gamePDA), "AccountDoesNotExist", {
      fallbackSubstring: "Account not found",
    });
  });
});
