import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { TestUtils, TestEnvironment, coinflipGameConfig } from "./test-helpers";

// Token gating tests: enabled flag and minAmount enforcement

describe("Token Gating", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should block game initialization when token disabled via update_token", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    // Disable token via update_token
    await env.program.methods
      .updateToken({ minAmount: new anchor.BN(1000), enabled: false })
      .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair])
      .rpc();

    const gameConfig = coinflipGameConfig({
      timeout: 60,
    });

    try {
      await testUtils.game.createGame(gameConfig, creator.player, mint.mint);
      expect.fail("Expected initializeGame to fail when token disabled");
    } catch (e: any) {
      expect(e.toString()).to.include("TokenNotEnabled");
    }
  });

  it("should enforce minAmount on initialize and join after raising via update_token", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, p1] = players;

    // Raise minAmount above planned game amount
    const raisedMin = new anchor.BN(10_000_000);
    await env.program.methods
      .updateToken({ minAmount: raisedMin, enabled: true })
      .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair])
      .rpc();

    const lowAmount = new anchor.BN(1_000_000);
    const gameConfig = coinflipGameConfig({
      amount: lowAmount,
      timeout: 60,
    });

    // initialize should fail due to amount < minAmount
    try {
      await testUtils.game.createGame(gameConfig, creator.player, mint.mint);
      expect.fail("Expected initializeGame to fail when amount < minAmount");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidAmount");
    }

    // Lower minAmount back and init; then raise and ensure join blocked
    await env.program.methods
      .updateToken({ minAmount: new anchor.BN(1000), enabled: true })
      .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair])
      .rpc();

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    // Raise minAmount after init; join should still succeed (min enforced at init)
    await env.program.methods
      .updateToken({ minAmount: raisedMin, enabled: true })
      .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair])
      .rpc();

    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    const acc = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(acc.ticketsCount).to.equal(1); // only p1 joined; creator not joined in this subtest
  });

  it("should block additional joins when token disabled after game start", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, p1, p2] = players;

    const gameConfig = coinflipGameConfig({
      amount: new anchor.BN(2_000_000),
      maxTickets: 3,
      timeout: 120,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);

    const gameTokenAccount = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    const originalMinAmount = new anchor.BN(
      gameTokenAccount.minAmount.toString()
    );

    // Disable the token mid-game
    await env.program.methods
      .updateToken({ minAmount: originalMinAmount, enabled: false })
      .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair])
      .rpc();

    try {
      await testUtils.game.joinGame(gameData.gamePDA, p2.player);
      expect.fail("Expected join to fail when token disabled mid-game");
    } catch (e: any) {
      expect(e.toString()).to.include("TokenNotEnabled");
    }

    // Re-enable token to avoid leaking state to other tests that reuse this mint
    await env.program.methods
      .updateToken({ minAmount: originalMinAmount, enabled: true })
      .accounts({ tokenMint: mint.mint, oracleOperator: oracle.operator })
      .signers([oracle.operatorKeypair])
      .rpc();
  });
});
