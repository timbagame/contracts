import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestEnvironment,
  TestUtils,
  giveawayGameConfig,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  ensureOperatorAta,
  gameTokenContextFromMint,
} from "./test-helpers";

async function updateOracleConfig(
  env: TestEnvironment,
  nextConfig: {
    feePercentage: number;
    oracleBufferTime: anchor.BN;
    maxTickets: number;
    maxTimeout: anchor.BN;
    minTimeout: anchor.BN;
  }
): Promise<void> {
  const oracle = env.oracle!;

  await env.program.methods
    .updateOracle(nextConfig)
    .accounts({
      oldOracleOperator: oracle.operator,
      newOracleOperator: oracle.operator,
    })
    .signers([oracle.operatorKeypair])
    .rpc();
}

describe("Fee Overflow Guard", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("handles near-u64-max fee accrual without precision loss", async () => {
    const oracle = env.oracle!;

    const originalConfig = {
      feePercentage: oracle.config.feePercentage,
      oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
      maxTickets: oracle.config.maxTickets,
      maxTimeout: new anchor.BN(oracle.config.maxTimeout),
      minTimeout: new anchor.BN(oracle.config.minTimeout),
    };

    const updatedConfig = {
      feePercentage: 100,
      oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
      maxTickets: oracle.config.maxTickets,
      maxTimeout: new anchor.BN(oracle.config.maxTimeout),
      minTimeout: new anchor.BN(oracle.config.minTimeout),
    };

    await updateOracleConfig(env, updatedConfig);
    oracle.config.feePercentage = 100;

    try {
      const mint = await testUtils.mint.createMint();

      const creator = await testUtils.player.createPlayer(mint.mint);
      const participant = await testUtils.player.createPlayer(mint.mint);

      const massivePrize = new anchor.BN("18446744073709500000");
      await testUtils.player.fundPlayer(creator, mint, massivePrize);

      const giveawayConfig = giveawayGameConfig({
        amount: massivePrize,
        maxTickets: new anchor.BN(1),
        minTickets: new anchor.BN(1),
        timeout: new anchor.BN(30),
      });

      const gameData = await testUtils.game.createGame(
        giveawayConfig,
        creator.player,
        mint.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, participant.player);

      const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([participant], winnerIndex);

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex,
        oracle.operatorKeypair
      );

      const gameTokenAfter = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(
        new anchor.BN(gameTokenAfter.feeAmount.toString()).eq(massivePrize)
      ).to.be.true;

      const operatorAta = await ensureOperatorAta(
        env.provider.connection,
        oracle,
        mint.mint
      );
      const preOperatorBalance =
        await env.provider.connection.getTokenAccountBalance(operatorAta);

      const tokenContext = gameTokenContextFromMint(mint, env.program);

      await env.program.methods
        .withdrawTokenFee()
        .accountsStrict({
          gameTokenCtx: tokenContext,
          oracle: oracle.oraclePDA,
          oracleOperator: oracle.operator,
          oracleOperatorTokenAccount: operatorAta,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([oracle.operatorKeypair])
        .rpc();

      const postOperatorBalance =
        await env.provider.connection.getTokenAccountBalance(operatorAta);
      const received = new anchor.BN(postOperatorBalance.value.amount).sub(
        new anchor.BN(preOperatorBalance.value.amount)
      );
      expect(received.eq(massivePrize)).to.be.true;

      const gameTokenFinal = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(new anchor.BN(gameTokenFinal.feeAmount.toString()).isZero()).to.be
        .true;
    } finally {
      await updateOracleConfig(env, originalConfig);
      oracle.config.feePercentage = originalConfig.feePercentage;
    }
  }).timeout(120_000);
});
