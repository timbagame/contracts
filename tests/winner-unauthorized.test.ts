import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  calculateWinnerIndex,
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
    const gameData = testUtils.game.generateGamePDA();
    const [creator, player1] = players;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );

    // Use a random unrelated key as fake winner
    const fakeWinner = anchor.web3.Keypair.generate();

    try {
      await testUtils.game.completeGame(
        gameData,
        fakeWinner.publicKey, // unauthorized
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );
      expect.fail("Completion should fail for unauthorized winner");
    } catch (e) {
      // Program error message is human-readable ("Unauthorized player") not enum variant
      const msg = e.toString();
      expect(msg).to.include("WinnerPubkeyHashMismatch");
    }
  });
});
