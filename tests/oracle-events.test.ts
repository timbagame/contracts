import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import type { Timba } from "../target/types/timba";
import { TestEnvironment, TestUtils } from "./test-helpers";

type TimbaEvents = anchor.IdlEvents<Timba>;
type TimbaEventName = keyof TimbaEvents;

describe("Oracle Events", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  const subscribeEvent = async <TEvent extends TimbaEventName>(
    eventName: TEvent
  ) => {
    let listenerId: number | undefined;
    let settled = false;
    let resolveEvent: (value: TimbaEvents[TEvent]) => void;
    let rejectEvent: (reason?: unknown) => void;

    const wait = new Promise<TimbaEvents[TEvent]>((resolve, reject) => {
      resolveEvent = resolve;
      rejectEvent = reject;
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectEvent(new Error(`${eventName} timeout`));
      }
    }, 10000);

    listenerId = await env.program.addEventListener(
      eventName,
      (event: TimbaEvents[TEvent]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveEvent(event);
      }
    );

    const dispose = async () => {
      clearTimeout(timer);
      if (listenerId !== undefined) {
        await env.program.removeEventListener(listenerId);
      }
    };

    wait.catch(async () => {
      await dispose().catch(() => {});
    });

    return { wait, dispose };
  };

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

    const subscription = await subscribeEvent("oracleUpdated");

    try {
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

      const event = await subscription.wait;
      expect(event.oldOperator).to.deep.equal(oracle.operator);
      expect(event.newOperator).to.deep.equal(newOperator.publicKey);
      expect(event.feePercentage).to.equal(nextConfig.feePercentage);
      expect(Number(event.oracleBufferTime)).to.equal(
        nextConfig.oracleBufferTime
      );
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
      expect(updatedOracle.maxTimeout.toNumber()).to.equal(
        nextConfig.maxTimeout
      );
      expect(updatedOracle.minTimeout.toNumber()).to.equal(
        nextConfig.minTimeout
      );
    } finally {
      await subscription.dispose().catch(() => {});

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

    const subscription = await subscribeEvent("oracleUpdated");

    try {
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

      const event = await subscription.wait;
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
      await subscription.dispose().catch(() => {});

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

      const restored = await env.program.account.oracle.fetch(oracle.oraclePDA);
      expect(restored.feePercentage).to.equal(oracle.config.feePercentage);
      expect(restored.oracleBufferTime.toNumber()).to.equal(
        oracle.config.oracleBufferTime
      );
      expect(restored.maxTickets).to.equal(oracle.config.maxTickets);
      expect(restored.maxTimeout.toNumber()).to.equal(oracle.config.maxTimeout);
      expect(restored.minTimeout.toNumber()).to.equal(oracle.config.minTimeout);
    }
  }).timeout(60000);
});
