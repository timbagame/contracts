import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  calculateWinnerIndex,
  getWinnerFromPlayers,
} from "./test-helpers";

// Verifies fee accumulation on game completion and distribution to winner

describe("Fee Accumulation", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("should accumulate fee and pay net winnings to winner", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, player1] = players;

    // Use a higher fee to make assertion clearer (5%) -- oracle already exists so cannot update easily here.
    // We rely on default fee 1% set in first oracle initialization.
    const ticketAmount = new anchor.BN(2_000_000);

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: ticketAmount,
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

    const gameAccountBefore = await env.program.account.game.fetch(
      gameData.gamePDA
    );

    const winnerIndex = calculateWinnerIndex(
      gameAccountBefore.ticketsCount,
      gameData.secretKey,
      Number(gameAccountBefore.lastSlot)
    );
    const winnerPlayer = getWinnerFromPlayers([creator, player1], winnerIndex);
    const winnerPre = await env.provider.connection.getTokenAccountBalance(
      winnerPlayer.playerTokenAccount.address
    );

    const totalPot = ticketAmount.mul(new anchor.BN(2));
    const feePct = oracle.config.feePercentage; // 1
    const expectedFee = totalPot
      .mul(new anchor.BN(feePct))
      .div(new anchor.BN(100));
    const expectedWinnerAmount = totalPot.sub(expectedFee);

    await testUtils.game.completeGame(
      gameData,
      winnerPlayer.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    // Game account closed; fetch game token to inspect fee accumulation
    const gameTokenAccountPDA = mint.gameTokenPDA;
    const gameTokenAccount = await env.program.account.gameToken.fetch(
      gameTokenAccountPDA
    );
    expect(new anchor.BN(gameTokenAccount.feeAmount).eq(expectedFee)).to.be
      .true;

    const winnerPost = await env.provider.connection.getTokenAccountBalance(
      winnerPlayer.playerTokenAccount.address
    );

    const delta = new anchor.BN(winnerPost.value.amount).sub(
      new anchor.BN(winnerPre.value.amount)
    );
    expect(delta.eq(expectedWinnerAmount)).to.be.true;

    // Ensure winner got net pot (not full) and fee retained
    expect(delta.lt(totalPot)).to.be.true;
  });
});
