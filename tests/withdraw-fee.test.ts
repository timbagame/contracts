import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  deriveGameAccounts,
  toGameTokenContext,
  gameTokenContextFromMint,
  subscribeEvent,
} from "./test-helpers";

// Verifies fee withdrawal transfers accumulated fees to oracle operator

async function ensureOperatorAta(
  connection: anchor.web3.Connection,
  mint: anchor.web3.PublicKey,
  operator: anchor.web3.Keypair
): Promise<anchor.web3.PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    operator,
    mint,
    operator.publicKey
  );
  return account.address;
}

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
    const gameData = testUtils.game.generateGamePDA();
    const [creator, player1] = players;

    const ticketAmount = new anchor.BN(1_500_000);

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
      mint.mint,
      oracle.operatorKeypair
    );
    const operatorPre = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );

    const oraclePubkey = oracle.oracle ?? oracle.oraclePDA;
    if (!oraclePubkey) {
      throw new Error("Oracle not initialized for withdraw fee test");
    }

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
      mint.mint,
      oracle.operatorKeypair
    );
    const preBalance = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );

    const subscription = await subscribeEvent(
      env.program,
      "tokenFeeWithdrawn",
      {
        timeoutMs: 15_000,
      }
    );

    try {
      const zeroFeeContext = gameTokenContextFromMint(mint);
      const zeroFeeOracle = oracle.oracle ?? oracle.oraclePDA;
      if (!zeroFeeOracle) {
        throw new Error("Oracle not initialized for zero-fee withdraw test");
      }

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

      const event = await subscription.wait;
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
    } finally {
      await subscription.dispose().catch(() => {});
    }
  });

  it("should allow withdrawing fees even when the token configuration is disabled", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const gameData = testUtils.game.generateGamePDA();
    const [creator, player1] = players;

    const ticketAmount = new anchor.BN(2_000_000);
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: ticketAmount,
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      cfg,
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
      mint.mint,
      oracle.operatorKeypair
    );
    const before = await env.provider.connection.getTokenAccountBalance(
      operatorAta
    );

    const subscription = await subscribeEvent(
      env.program,
      "tokenFeeWithdrawn",
      {
        timeoutMs: 15_000,
      }
    );

    const disabledOracle = oracle.oracle ?? oracle.oraclePDA;
    if (!disabledOracle) {
      throw new Error(
        "Oracle not initialized for disabled token withdraw test"
      );
    }

    const disabledDerived = await deriveGameAccounts(
      env.program,
      gameData.gamePDA,
      {
        tokenMint: mint.mint,
      }
    );
    const disabledCtx = toGameTokenContext(disabledDerived);

    try {
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

      const event = await subscription.wait;
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
      await subscription.dispose().catch(() => {});

      // Restore token enabled state to avoid leaking to other tests
      await env.program.methods
        .updateToken({ minAmount: originalMinAmount, enabled: true })
        .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
        .signers([oracle.operatorKeypair])
        .rpc();
    }
  }).timeout(120000);
});
