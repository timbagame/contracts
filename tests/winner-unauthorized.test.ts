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

    // Use another player from the pool who did NOT join (players[2])
    const fakeWinner = players[2];

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
      console.log("RAW ERROR OBJECT:", e);
      try { console.log("RAW ERROR JSON:", JSON.stringify(e, null, 2)); } catch {}
      console.log("RAW ERROR toString:", e.toString());
      if (e.logs) {
        console.log("PROGRAM LOGS:\n" + e.logs.join("\n"));
      }
      const code = e.error?.errorCode?.code;
      const human = e.error?.errorMessage;
      console.log("Parsed code=", code, "human=", human);
      const msg = e.toString();
      expect(msg).to.include("Winner pubkey hash mismatch");
    }
  });
});
