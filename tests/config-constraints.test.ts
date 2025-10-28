import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, coinflipGameConfig } from "./test-helpers";

// Config validation constraints (tickets and timeout) and invalid oracle updates

describe("Config Constraints", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should reject coinflip with less than 2 players allowed", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const cfg = coinflipGameConfig({
      maxTickets: 1,
      minTickets: 1,
      timeout: 60,
    });

    try {
      await testUtils.game.createGame(cfg, creator.player, mint.mint);
      expect.fail("Should not allow coinflip with <2 tickets");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }
  });

  it("should reject when minTickets > maxTickets", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const cfg = coinflipGameConfig({
      maxTickets: 3,
      minTickets: 4,
      timeout: 60,
    });

    try {
      await testUtils.game.createGame(cfg, creator.player, mint.mint);
      expect.fail("Should reject minTickets > maxTickets");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }
  });

  it("should reject timeout outside oracle range and invalid oracle updates", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    // Update oracle to reduce maxTickets to small number for subsequent checks
    await env.program.methods
      .updateOracle({
        feePercentage: oracle.config.feePercentage,
        oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
        maxTickets: 10,
        maxTimeout: new anchor.BN(oracle.config.maxTimeout),
        minTimeout: new anchor.BN(oracle.config.minTimeout),
      })
      .accounts({
        oldOracleOperator: oracle.operator,
        newOracleOperator: oracle.operator,
      })
      .signers([oracle.operatorKeypair, oracle.operatorKeypair])
      .rpc();

    // Timeout above maxTimeout (default 86400) should fail
    const tooLong = coinflipGameConfig({
      timeout: 200_000,
    });
    try {
      await testUtils.game.createGame(tooLong, creator.player, mint.mint);
      expect.fail("Should reject timeout above oracle max");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTimeout");
    }

    // maxTickets over oracle.max_tickets should fail
    const tooMany = coinflipGameConfig({
      maxTickets: 11,
      minTickets: 2,
      timeout: 60,
    });
    try {
      await testUtils.game.createGame(tooMany, creator.player, mint.mint);
      expect.fail("Should reject > oracle.max_tickets");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }

    // Invalid oracle update values should be rejected (fee > 100)
    try {
      await env.program.methods
        .updateOracle({
          feePercentage: 255,
          oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
          maxTickets: 10,
          maxTimeout: new anchor.BN(oracle.config.maxTimeout),
          minTimeout: new anchor.BN(oracle.config.minTimeout),
        })
        .accounts({
          oldOracleOperator: oracle.operator,
          newOracleOperator: oracle.operator,
        })
        .signers([oracle.operatorKeypair, oracle.operatorKeypair])
        .rpc();
      expect.fail("Should reject invalid fee percentage > 100");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidAmount");
    }

    // Restore oracle configuration (maxTickets) to default to avoid leaking state to other tests
    await env.program.methods
      .updateOracle({
        feePercentage: oracle.config.feePercentage,
        oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
        maxTickets: oracle.config.maxTickets, // restore to original (likely 50000)
        maxTimeout: new anchor.BN(oracle.config.maxTimeout),
        minTimeout: new anchor.BN(oracle.config.minTimeout),
      })
      .accounts({
        oldOracleOperator: oracle.operator,
        newOracleOperator: oracle.operator,
      })
      .signers([oracle.operatorKeypair, oracle.operatorKeypair])
      .rpc();
  });

  it("should reject timeout below oracle minimum", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const tooShort = coinflipGameConfig({
      timeout: 0,
    });

    try {
      await testUtils.game.createGame(tooShort, creator.player, mint.mint);
      expect.fail("Should reject timeout below oracle minimum");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTimeout");
    }
  });

  it("should reject oracle updates with inverted timeouts or zero maxTickets", async () => {
    const { oracle } = await testUtils.quickSetup();

    const smallerMaxTimeout = Math.max(oracle.config.minTimeout - 1, 0);
    const largerMinTimeout = oracle.config.minTimeout + 10;

    // maxTimeout < minTimeout should be rejected
    try {
      await env.program.methods
        .updateOracle({
          feePercentage: oracle.config.feePercentage,
          oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
          maxTickets: oracle.config.maxTickets,
          maxTimeout: new anchor.BN(smallerMaxTimeout),
          minTimeout: new anchor.BN(largerMinTimeout),
        })
        .accounts({
          oldOracleOperator: oracle.operator,
          newOracleOperator: oracle.operator,
        })
        .signers([oracle.operatorKeypair, oracle.operatorKeypair])
        .rpc();
      expect.fail("Should reject oracle update when maxTimeout < minTimeout");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTimeout");
    }

    // maxTickets must be > 0
    try {
      await env.program.methods
        .updateOracle({
          feePercentage: oracle.config.feePercentage,
          oracleBufferTime: new anchor.BN(oracle.config.oracleBufferTime),
          maxTickets: 0,
          maxTimeout: new anchor.BN(oracle.config.maxTimeout),
          minTimeout: new anchor.BN(oracle.config.minTimeout),
        })
        .accounts({
          oldOracleOperator: oracle.operator,
          newOracleOperator: oracle.operator,
        })
        .signers([oracle.operatorKeypair, oracle.operatorKeypair])
        .rpc();
      expect.fail("Should reject oracle update when maxTickets is zero");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }

    // oracleBufferTime must be > 0
    try {
      await env.program.methods
        .updateOracle({
          feePercentage: oracle.config.feePercentage,
          oracleBufferTime: new anchor.BN(0),
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
      expect.fail("Should reject oracle update when buffer time is zero");
    } catch (e: any) {
      expect(e.toString()).to.include("OracleBufferTooSmall");
    }
  });
});
