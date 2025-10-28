import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  calculatePayoutBreakdown,
  giveawayGameConfig,
  awaitOracleCompletionReady,
} from "./test-helpers";

// Giveaway completion: 1 ticket max => ready immediately on first join; winner receives prize - fee

describe("Giveaway Completion", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should complete a giveaway and pay prize minus fee to winner without requiring player funds", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    // Create a brand-new player with zero token balance for THIS mint
    const zeroPlayer = await testUtils.player.createPlayer(mint.mint);

    const prize = new anchor.BN(5_000_000);
    const cfg = giveawayGameConfig({
      amount: prize, // total prize funded by creator
      maxTickets: 1, // single participant triggers readiness without waiting
      minTickets: 1,
    });

    // Creator funds the prize at init
    const beforeCreator = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    const gameData = await testUtils.game.createFilledGame(
      cfg,
      creator,
      mint.mint,
      [zeroPlayer],
      { joinCreator: false }
    );

    const afterCreator = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );
    expect(
      new anchor.BN(beforeCreator.value.amount)
        .sub(new anchor.BN(afterCreator.value.amount))
        .eq(prize)
    ).to.be.true;

    // Zero-balance player joins (should succeed for giveaway)
    // Complete with zeroPlayer as winner (winnerIndex is 0 due to 1 ticket)
    const winnerIndex = 0;
    const { winnerAmount: expectedWinnerAmount } = calculatePayoutBreakdown(
      prize,
      oracle.config.feePercentage
    );

    const preWinner = await env.provider.connection.getTokenAccountBalance(
      zeroPlayer.playerTokenAccount.address
    );

    await testUtils.game.completeGame(
      gameData,
      zeroPlayer.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    const postWinner = await env.provider.connection.getTokenAccountBalance(
      zeroPlayer.playerTokenAccount.address
    );
    const delta = new anchor.BN(postWinner.value.amount).sub(
      new anchor.BN(preWinner.value.amount)
    );
    expect(delta.eq(expectedWinnerAmount)).to.be.true;
  });

  it("should allow completing a giveaway with a single player after the timeout", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, soloPlayer] = players;

    const prize = new anchor.BN(3_000_000);
    const timeoutSeconds = 3;

    const config = giveawayGameConfig({
      amount: prize,
      maxTickets: 5,
      timeout: timeoutSeconds,
    });

    const gameData = await testUtils.game.createFilledGame(
      config,
      creator,
      mint.mint,
      [soloPlayer],
      { joinCreator: false }
    );

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(1);

    // Wait until the timeout elapses while remaining inside the oracle buffer
    // window so the completion instruction is still permitted.
    await awaitOracleCompletionReady(gameAccount, oracle.config);

    const preWinner = await env.provider.connection.getTokenAccountBalance(
      soloPlayer.playerTokenAccount.address
    );

    const winnerIndex = testUtils.game.calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );

    const { winnerAmount: expectedWinnerAmount } = calculatePayoutBreakdown(
      prize,
      oracle.config.feePercentage
    );

    await testUtils.game.completeGame(
      gameData,
      soloPlayer.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    const postWinner = await env.provider.connection.getTokenAccountBalance(
      soloPlayer.playerTokenAccount.address
    );
    const delta = new anchor.BN(postWinner.value.amount).sub(
      new anchor.BN(preWinner.value.amount)
    );
    expect(delta.eq(expectedWinnerAmount)).to.be.true;
  }).timeout(60000);
});
