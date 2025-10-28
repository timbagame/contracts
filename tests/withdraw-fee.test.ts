import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  deriveGameAccounts,
  toGameTokenContext,
  gameTokenContextFromMint,
  captureEvent,
  coinflipGameConfig,
  getOraclePublicKey,
  ensureOperatorAta,
} from "./test-helpers";

// Verifies fee withdrawal transfers accumulated fees to oracle operator

describe("Withdraw Fee", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should withdraw accumulated fees to oracle operator", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;

    const ticketAmount = new anchor.BN(1_500_000);

    const gameConfig = coinflipGameConfig({
      amount: ticketAmount,
    });

    const gameData = await testUtils.game.createFilledGame(
      gameConfig,
      creator,
      mint.mint,
      [player1]
    );

    const gameAccountBefore = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccountBefore.ticketsCount,
      gameData.secretKey,
      Number(gameAccountBefore.lastSlot)
    );
    const winnerPlayer = getWinnerFromPlayers([creator, player1], winnerIndex);

    await testUtils.game.completeGame(
      gameData,
      winnerPlayer.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    const gameTokenAccount = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    const accumulatedFee = new anchor.BN(gameTokenAccount.feeAmount);
    expect(accumulatedFee.gt(new anchor.BN(0))).to.be.true;

    // Operator balance before
    const operatorAta = await ensureOperatorAta(
      env.provider.connection,
      oracle,
      mint.mint
    );
    const operatorPre = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );

    const oraclePubkey = getOraclePublicKey(oracle);

    const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
      tokenMint: mint.mint,
    });
    const gameTokenCtx = toGameTokenContext(derived);

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

    const gameTokenAfter = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    expect(new anchor.BN(gameTokenAfter.feeAmount).isZero()).to.be.true;

    const operatorPost = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );
    const delta = new anchor.BN(operatorPost.value.amount).sub(
      new anchor.BN(operatorPre.value.amount)
    );
    expect(delta.eq(accumulatedFee)).to.be.true;
  });

  it("should emit zero-amount withdraw events when no fees accumulated", async () => {
    const { oracle, mint } = await testUtils.quickSetup();

    const operatorAta = await ensureOperatorAta(
      env.provider.connection,
      oracle,
      mint.mint
    );
    const preBalance = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );

    const event = await captureEvent(
      env.program,
      "tokenFeeWithdrawn",
      async () => {
        const zeroFeeContext = gameTokenContextFromMint(mint);
        const zeroFeeOracle = getOraclePublicKey(oracle);

        await env.program.methods
          .withdrawTokenFee()
          .accountsStrict({
            gameTokenCtx: zeroFeeContext,
            oracle: zeroFeeOracle,
            oracleOperator: oracle.operator,
            oracleOperatorTokenAccount: operatorAta,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([oracle.operatorKeypair])
          .rpc();
      },
      {
        timeoutMs: 15_000,
      }
    );

    expect(event.operator).to.deep.equal(oracle.operator);
    expect(event.tokenMint).to.deep.equal(mint.mint);
    expect(new anchor.BN(event.amount).isZero()).to.be.true;

    const postBalance = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );
    expect(postBalance.value.amount).to.equal(preBalance.value.amount);

    const gameTokenAfter = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    expect(new anchor.BN(gameTokenAfter.feeAmount).isZero()).to.be.true;
  });

  it("should allow withdrawing fees even when the token configuration is disabled", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;

    const ticketAmount = new anchor.BN(2_000_000);
    const cfg = coinflipGameConfig({
      amount: ticketAmount,
    });

    const gameData = await testUtils.game.createFilledGame(
      cfg,
      creator,
      mint.mint,
      [player1]
    );

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      winnerIndex
    );

    const gameTokenBefore = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    const accumulatedFee = new anchor.BN(gameTokenBefore.feeAmount);
    expect(accumulatedFee.gt(new anchor.BN(0))).to.be.true;

    // Disable token gating but keep accumulated fees on account
    const originalMinAmount = new anchor.BN(
      gameTokenBefore.minAmount.toString()
    );
    await env.program.methods
      .updateToken({ minAmount: originalMinAmount, enabled: false })
      .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair])
      .rpc();

    const operatorAta = await ensureOperatorAta(
      env.provider.connection,
      oracle,
      mint.mint
    );
    const before = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );

    const disabledOracle = getOraclePublicKey(oracle);

    const disabledDerived = await deriveGameAccounts(
      env.program,
      gameData.gamePDA,
      {
        tokenMint: mint.mint,
      }
    );
    const disabledCtx = toGameTokenContext(disabledDerived);

    try {
      const event = await captureEvent(
        env.program,
        "tokenFeeWithdrawn",
        async () => {
          await env.program.methods
            .withdrawTokenFee()
            .accountsStrict({
              gameTokenCtx: disabledCtx,
              oracle: disabledOracle,
              oracleOperator: oracle.operator,
              oracleOperatorTokenAccount: operatorAta,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([oracle.operatorKeypair])
            .rpc();
        },
        {
          timeoutMs: 15_000,
        }
      );

      expect(event.operator).to.deep.equal(oracle.operator);
      expect(event.tokenMint).to.deep.equal(mint.mint);
      expect(new anchor.BN(event.amount).eq(accumulatedFee)).to.be.true;

      const after = await env.provider.connection.getTokenAccountBalance(
        operatorAta
      );
      const received = new anchor.BN(after.value.amount).sub(
        new anchor.BN(before.value.amount)
      );
      expect(received.eq(accumulatedFee)).to.be.true;

      const gameTokenAfter = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(new anchor.BN(gameTokenAfter.feeAmount).isZero()).to.be.true;
    } finally {
      // Restore token enabled state to avoid leaking to other tests
      await env.program.methods
        .updateToken({ minAmount: originalMinAmount, enabled: true })
        .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
        .signers([oracle.operatorKeypair])
        .rpc();
    }
  }).timeout(120000);
});
