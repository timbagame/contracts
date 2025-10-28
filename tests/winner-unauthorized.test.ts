import { expect } from "chai";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  coinflipGameConfig,
} from "./test-helpers";

// Tests that completion rejects winner pubkey not in participant list

describe("Winner Authorization", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    await env.initialize();
  });

  it("should fail completion if winner not a participant", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1, fakeWinner] = players;

    const gameConfig = coinflipGameConfig();

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );

    // fakeWinner did not join, should produce mismatch
    try {
      await testUtils.game.completeGame(
        gameData,
        fakeWinner.player.publicKey, // unauthorized (not in participant list)
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );
      expect.fail("Completion should fail for unauthorized winner");
    } catch (e: any) {
      expect(e.toString()).to.include("Winner hash mismatch");
    }
  });
});
