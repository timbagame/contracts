import { expect } from "chai";
import {
  TestEnvironment,
  TestUtils,
  calculateWinnerIndex,
  coinflipGameConfig,
  expectAnchorError,
  getWinnerFromPlayers,
} from "./test-helpers";

describe("Anchor TypeScript Client Smoke", () => {
  it("executes a complete coinflip lifecycle through the generated client", async () => {
    const env = TestEnvironment.getInstance();
    const testUtils = new TestUtils();
    await env.initialize();
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, participant] = players;
    const gameData = await testUtils.game.createGame(
      coinflipGameConfig(),
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, participant.player);

    const game = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      game.ticketsCount,
      gameData.secretKey,
      Number(game.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, participant], winnerIndex);
    const balanceBefore = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );
    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );
    const balanceAfter = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );
    expect(
      BigInt(balanceAfter.value.amount) > BigInt(balanceBefore.value.amount)
    ).to.equal(true);
    await expectAnchorError(
      testUtils.game.fetchGame(gameData.gamePDA),
      "AccountDoesNotExist",
      { fallbackSubstring: "Account does not exist" }
    );
  });
});
