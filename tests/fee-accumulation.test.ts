import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  calculatePayoutBreakdown,
  coinflipGameConfig,
  ensureOperatorAta,
  getOraclePublicKey,
  gameTokenContextFromMint,
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
    const [creator, player1] = players;

    // Use a higher fee to make assertion clearer (5%) -- oracle already exists so cannot update easily here.
    // We rely on default fee 1% set in first oracle initialization.
    const ticketAmount = new anchor.BN(2_000_000);

    const gameConfig = coinflipGameConfig({
      amount: ticketAmount,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const gameAccountBefore = await testUtils.game.fetchGame(gameData.gamePDA);

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
    const { fee: expectedFee, winnerAmount: expectedWinnerAmount } =
      calculatePayoutBreakdown(totalPot, oracle.config.feePercentage);

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

  it("should support 100% fee without crediting winner while preserving withdrawal", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;

    const originalConfig = { ...oracle.config };

    const updateArgs = {
      feePercentage: 100,
      oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
      maxTickets: oracle.config.maxTickets,
      maxTimeout: new anchor.BN(oracle.config.maxTimeout),
      minTimeout: new anchor.BN(oracle.config.minTimeout),
    } as const;

    await env.program.methods
      .updateOracle(updateArgs)
      .accounts({
        oldOracleOperator: oracle.operator,
        newOracleOperator: oracle.operator,
      })
      .signers([oracle.operatorKeypair, oracle.operatorKeypair])
      .rpc();

    try {
      const ticketAmount = new anchor.BN(2_000_000);
      const gameConfig = coinflipGameConfig({ amount: ticketAmount });

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      const gameAccountBefore = await testUtils.game.fetchGame(
        gameData.gamePDA
      );
      const winnerIndex = calculateWinnerIndex(
        gameAccountBefore.ticketsCount,
        gameData.secretKey,
        Number(gameAccountBefore.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      const winnerPre = await env.provider.connection.getTokenAccountBalance(
        winner.playerTokenAccount.address
      );

      const totalPot = ticketAmount.mul(new anchor.BN(2));
      const { fee: expectedFee, winnerAmount: expectedWinnerAmount } =
        calculatePayoutBreakdown(totalPot, 100);
      expect(expectedWinnerAmount.isZero()).to.be.true;

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      const winnerPost = await env.provider.connection.getTokenAccountBalance(
        winner.playerTokenAccount.address
      );
      const delta = new anchor.BN(winnerPost.value.amount).sub(
        new anchor.BN(winnerPre.value.amount)
      );
      expect(delta.isZero()).to.be.true;

      const gameTokenAccount = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(new anchor.BN(gameTokenAccount.feeAmount).eq(expectedFee)).to.be
        .true;

      const operatorAta = await ensureOperatorAta(
        env.provider.connection,
        oracle,
        mint.mint
      );
      const opBalanceBefore = await env.provider.connection.getTokenAccountBalance(
        operatorAta
      );

      const oraclePubkey = getOraclePublicKey(oracle);
      const gameTokenCtx = gameTokenContextFromMint(mint, env.program);

      await env.program.methods
        .withdrawTokenFee()
        .accountsStrict({
          gameTokenCtx,
          oracle: oraclePubkey,
          oracleOperator: oracle.operator,
          oracleOperatorTokenAccount: operatorAta,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([oracle.operatorKeypair])
        .rpc();

      const opBalanceAfter = await env.provider.connection.getTokenAccountBalance(
        operatorAta
      );
      const operatorDelta = new anchor.BN(opBalanceAfter.value.amount).sub(
        new anchor.BN(opBalanceBefore.value.amount)
      );
      expect(operatorDelta.eq(expectedFee)).to.be.true;

      const gameTokenAfter = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(new anchor.BN(gameTokenAfter.feeAmount).isZero()).to.be.true;
    } finally {
      await env.program.methods
        .updateOracle({
          feePercentage: originalConfig.feePercentage,
          oracleBufferTime: new anchor.BN(originalConfig.oracleBufferTime),
          maxTickets: originalConfig.maxTickets,
          maxTimeout: new anchor.BN(originalConfig.maxTimeout),
          minTimeout: new anchor.BN(originalConfig.minTimeout),
        })
        .accounts({
          oldOracleOperator: oracle.operator,
          newOracleOperator: oracle.operator,
        })
        .signers([oracle.operatorKeypair, oracle.operatorKeypair])
        .rpc();
    }
  }).timeout(120000);
});
