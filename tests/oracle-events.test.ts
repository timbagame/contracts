import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestEnvironment, TestUtils, captureEvent } from "./test-helpers";

describe("Oracle Events", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("should emit OracleUpdated when operator and config change", async () => {
    const { oracle } = await testUtils.quickSetup();

    const newOperator = anchor.web3.Keypair.generate();
    const connection = env.provider.connection;
    const airdropSig = await connection.requestAirdrop(
      newOperator.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    const nextConfig = {
      feePercentage: oracle.config.feePercentage,
      oracleBufferTime: oracle.config.oracleBufferTime,
      maxTickets: oracle.config.maxTickets,
      maxTimeout: oracle.config.maxTimeout,
      minTimeout: oracle.config.minTimeout,
    };

    try {
      const event = await captureEvent(
        env.program,
        "oracleUpdated",
        async () => {
          await env.program.methods
            .updateOracle({
              feePercentage: nextConfig.feePercentage,
              oracleBufferTime: new anchor.BN(nextConfig.oracleBufferTime),
              maxTickets: nextConfig.maxTickets,
              maxTimeout: new anchor.BN(nextConfig.maxTimeout),
              minTimeout: new anchor.BN(nextConfig.minTimeout),
            })
            .accounts({
              oldOracleOperator: oracle.operator,
              newOracleOperator: newOperator.publicKey,
            })
            .signers([oracle.operatorKeypair, newOperator])
            .rpc();
        }
      );

      expect(event.oldOperator).to.deep.equal(oracle.operator);
      expect(event.newOperator).to.deep.equal(newOperator.publicKey);
      expect(event.feePercentage).to.equal(nextConfig.feePercentage);
      expect(Number(event.oracleBufferTime)).to.equal(nextConfig.oracleBufferTime);
      expect(event.maxTickets).to.equal(nextConfig.maxTickets);
      expect(Number(event.maxTimeout)).to.equal(nextConfig.maxTimeout);
      expect(Number(event.minTimeout)).to.equal(nextConfig.minTimeout);

      const updatedOracle = await env.program.account.oracle.fetch(
        oracle.oraclePDA
      );
      expect(updatedOracle.operator.equals(newOperator.publicKey)).to.be.true;
      expect(updatedOracle.feePercentage).to.equal(nextConfig.feePercentage);
      expect(updatedOracle.oracleBufferTime.toNumber()).to.equal(
        nextConfig.oracleBufferTime
      );
      expect(updatedOracle.maxTickets).to.equal(nextConfig.maxTickets);
      expect(updatedOracle.maxTimeout.toNumber()).to.equal(nextConfig.maxTimeout);
      expect(updatedOracle.minTimeout.toNumber()).to.equal(nextConfig.minTimeout);
    } finally {
      await env.program.methods
        .updateOracle({
          feePercentage: oracle.config.feePercentage,
          oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
          maxTickets: oracle.config.maxTickets,
          maxTimeout: new anchor.BN(oracle.config.maxTimeout),
          minTimeout: new anchor.BN(oracle.config.minTimeout),
        })
        .accounts({
          oldOracleOperator: newOperator.publicKey,
          newOracleOperator: oracle.operator,
        })
        .signers([newOperator, oracle.operatorKeypair])
        .rpc();

      const restoredOracle = await env.program.account.oracle.fetch(
        oracle.oraclePDA
      );
      expect(restoredOracle.operator.equals(oracle.operator)).to.be.true;
    }
  }).timeout(60000);

  it("should emit OracleUpdated when updating configuration in place", async () => {
    const { oracle } = await testUtils.quickSetup();

    const feeDelta = oracle.config.feePercentage === 100 ? -1 : 1;
    const updatedConfig = {
      feePercentage: oracle.config.feePercentage + feeDelta,
      oracleBufferTime: oracle.config.oracleBufferTime,
      maxTickets: oracle.config.maxTickets,
      maxTimeout: oracle.config.maxTimeout,
      minTimeout: oracle.config.minTimeout,
    };

    try {
      const event = await captureEvent(
        env.program,
        "oracleUpdated",
        async () => {
          await env.program.methods
            .updateOracle({
              feePercentage: updatedConfig.feePercentage,
              oracleBufferTime: new anchor.BN(updatedConfig.oracleBufferTime),
              maxTickets: updatedConfig.maxTickets,
              maxTimeout: new anchor.BN(updatedConfig.maxTimeout),
              minTimeout: new anchor.BN(updatedConfig.minTimeout),
            })
            .accounts({
              oldOracleOperator: oracle.operator,
              newOracleOperator: oracle.operator,
            })
            .signers([oracle.operatorKeypair, oracle.operatorKeypair])
            .rpc();
        }
      );

      expect(event.oldOperator).to.deep.equal(oracle.operator);
      expect(event.newOperator).to.deep.equal(oracle.operator);
      expect(event.feePercentage).to.equal(updatedConfig.feePercentage);
      expect(Number(event.oracleBufferTime)).to.equal(
        updatedConfig.oracleBufferTime
      );
      expect(event.maxTickets).to.equal(updatedConfig.maxTickets);
      expect(Number(event.maxTimeout)).to.equal(updatedConfig.maxTimeout);
      expect(Number(event.minTimeout)).to.equal(updatedConfig.minTimeout);

      const onChain = await env.program.account.oracle.fetch(oracle.oraclePDA);
      expect(onChain.operator.equals(oracle.operator)).to.be.true;
      expect(onChain.feePercentage).to.equal(updatedConfig.feePercentage);
      expect(onChain.oracleBufferTime.toNumber()).to.equal(
        updatedConfig.oracleBufferTime
      );
      expect(onChain.maxTickets).to.equal(updatedConfig.maxTickets);
      expect(onChain.maxTimeout.toNumber()).to.equal(updatedConfig.maxTimeout);
      expect(onChain.minTimeout.toNumber()).to.equal(updatedConfig.minTimeout);
    } finally {
      await env.program.methods
        .updateOracle({
          feePercentage: oracle.config.feePercentage,
          oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
          maxTickets: oracle.config.maxTickets,
          maxTimeout: new anchor.BN(oracle.config.maxTimeout),
          minTimeout: new anchor.BN(oracle.config.minTimeout),
        })
        .accounts({
          oldOracleOperator: oracle.operator,
          newOracleOperator: oracle.operator,
        })
        .signers([oracle.operatorKeypair, oracle.operatorKeypair])
        .rpc();
    }
  }).timeout(60000);
});
