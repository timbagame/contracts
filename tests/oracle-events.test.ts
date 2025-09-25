import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import type { Coinflip } from "../target/types/coinflip";
import { TestEnvironment, TestUtils } from "./test-helpers";

type CoinflipEvents = anchor.IdlEvents<Coinflip>;
type CoinflipEventName = keyof CoinflipEvents;

describe("Oracle Events", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  const subscribeEvent = async <TEvent extends CoinflipEventName>(eventName: TEvent) => {
    let listenerId: number | undefined;
    let settled = false;
    let resolveEvent: (value: CoinflipEvents[TEvent]) => void;
    let rejectEvent: (reason?: unknown) => void;

    const wait = new Promise<CoinflipEvents[TEvent]>((resolve, reject) => {
      resolveEvent = resolve;
      rejectEvent = reject;
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectEvent(new Error(`${eventName} timeout`));
      }
    }, 10000);

    listenerId = await env.program.addEventListener(eventName, (event: CoinflipEvents[TEvent]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveEvent(event);
    });

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
    const airdropSig = await connection.requestAirdrop(newOperator.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
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
      expect(Number(event.oracleBufferTime)).to.equal(nextConfig.oracleBufferTime);
      expect(event.maxTickets).to.equal(nextConfig.maxTickets);
      expect(Number(event.maxTimeout)).to.equal(nextConfig.maxTimeout);
      expect(Number(event.minTimeout)).to.equal(nextConfig.minTimeout);
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
    }
  }).timeout(60000);
});
