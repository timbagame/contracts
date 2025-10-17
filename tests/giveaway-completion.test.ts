import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

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
    const gameData = testUtils.game.generateGamePDA();

    // Create a brand-new player with zero token balance for THIS mint
    const zeroPlayer = await testUtils.player.createPlayer(mint.mint);

    const prize = new anchor.BN(5_000_000);
    const cfg: GameConfig = {
      gameType: { giveaway: {} },
      amount: prize, // total prize funded by creator
      maxTickets: new anchor.BN(1), // single participant triggers readiness without waiting
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    // Creator funds the prize at init
    const beforeCreator = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
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
    await testUtils.game.joinGame(gameData.gamePDA, zeroPlayer.player);

    // Complete with zeroPlayer as winner (winnerIndex is 0 due to 1 ticket)
    const winnerIndex = 0;
    const feePct = oracle.config.feePercentage; // e.g., 1%
    const expectedFee = prize
      .mul(new anchor.BN(feePct))
      .div(new anchor.BN(100));
    const expectedWinnerAmount = prize.sub(expectedFee);

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
    const gameData = testUtils.game.generateGamePDA();

    const prize = new anchor.BN(3_000_000);
    const timeoutSeconds = 3;

    const config: GameConfig = {
      gameType: { giveaway: {} },
      amount: prize,
      maxTickets: new anchor.BN(5),
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(timeoutSeconds),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      config,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, soloPlayer.player);

    const gameAccount = await env.program.account.game.fetch(
      gameData.gamePDA
    );
    expect(gameAccount.ticketsCount).to.equal(1);

    await new Promise((resolve) =>
      setTimeout(resolve, (timeoutSeconds + 1) * 1000)
    );

    const preWinner = await env.provider.connection.getTokenAccountBalance(
      soloPlayer.playerTokenAccount.address
    );

    const winnerIndex = testUtils.game.calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );

    const feePct = oracle.config.feePercentage;
    const expectedFee = prize
      .mul(new anchor.BN(feePct))
      .div(new anchor.BN(100));
    const expectedWinnerAmount = prize.sub(expectedFee);

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
