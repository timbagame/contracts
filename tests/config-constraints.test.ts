import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, GameConfig } from "./test-helpers";

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
    const gameData = testUtils.game.generateGamePDA();

    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(1),
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(60),
      isPrivate: false,
    };

    try {
      await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);
      expect.fail("Should not allow coinflip with <2 tickets");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTicketsCount");
    }
  });

  it("should reject when minTickets > maxTickets", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator] = players;
    const gameData = testUtils.game.generateGamePDA();

    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(3),
      minTickets: new anchor.BN(4),
      timeout: new anchor.BN(60),
      isPrivate: false,
    };

    try {
      await testUtils.game.initializeGame(gameData, cfg, creator.player, mint.mint);
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
      .accounts({ oldOracleOperator: oracle.operator, newOracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair, oracle.operatorKeypair])
      .rpc();

    // Timeout above maxTimeout (default 86400) should fail
    const gameData1 = testUtils.game.generateGamePDA();
    const tooLong: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(200_000),
      isPrivate: false,
    };
    try {
      await testUtils.game.initializeGame(gameData1, tooLong, creator.player, mint.mint);
      expect.fail("Should reject timeout above oracle max");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidTimeout");
    }

    // maxTickets over oracle.max_tickets should fail
    const gameData2 = testUtils.game.generateGamePDA();
    const tooMany: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(11),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(60),
      isPrivate: false,
    };
    try {
      await testUtils.game.initializeGame(gameData2, tooMany, creator.player, mint.mint);
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
        .accounts({ oldOracleOperator: oracle.operator, newOracleOperator: oracle.operator })
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
      .accounts({ oldOracleOperator: oracle.operator, newOracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair, oracle.operatorKeypair])
      .rpc();
  });
});
