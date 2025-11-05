import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestEnvironment,
  TestUtils,
  giveawayGameConfig,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  expectAnchorError,
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

  it("rejects fee accrual that would overflow u64", async () => {
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
      const joiner = await testUtils.player.createPlayer(mint.mint);

      const bigPrize = new anchor.BN("18446744073709551500");
      const smallPrize = new anchor.BN(5000);
      const totalFunding = bigPrize.add(smallPrize);

      await testUtils.player.fundPlayer(creator, mint, totalFunding);

      const bigGiveawayConfig = giveawayGameConfig({
        amount: bigPrize,
        maxTickets: new anchor.BN(1),
        minTickets: new anchor.BN(1),
        timeout: new anchor.BN(60),
      });

      const bigGame = await testUtils.game.createGame(
        bigGiveawayConfig,
        creator.player,
        mint.mint
      );

      await testUtils.game.joinGame(bigGame.gamePDA, joiner.player);

      const bigGameAccount = await testUtils.game.fetchGame(bigGame.gamePDA);
      const initialWinnerIndex = calculateWinnerIndex(
        bigGameAccount.ticketsCount,
        bigGame.secretKey,
        Number(bigGameAccount.lastSlot)
      );
      const bigWinner = getWinnerFromPlayers([joiner], initialWinnerIndex);

      await testUtils.game.completeGame(
        bigGame,
        bigWinner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        initialWinnerIndex,
        oracle.operatorKeypair
      );

      const gameTokenAfterFirst = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(
        new anchor.BN(gameTokenAfterFirst.feeAmount.toString()).eq(bigPrize)
      ).to.be.true;

      const smallGiveawayConfig = giveawayGameConfig({
        amount: smallPrize,
        maxTickets: new anchor.BN(1),
        minTickets: new anchor.BN(1),
        timeout: new anchor.BN(60),
      });

      const smallGame = await testUtils.game.createGame(
        smallGiveawayConfig,
        creator.player,
        mint.mint
      );

      await testUtils.game.joinGame(smallGame.gamePDA, joiner.player);

      const smallGameAccount = await testUtils.game.fetchGame(smallGame.gamePDA);
      const overflowWinnerIndex = calculateWinnerIndex(
        smallGameAccount.ticketsCount,
        smallGame.secretKey,
        Number(smallGameAccount.lastSlot)
      );
      const overflowWinner = getWinnerFromPlayers(
        [joiner],
        overflowWinnerIndex
      );

      await expectAnchorError(
        testUtils.game.completeGame(
          smallGame,
          overflowWinner.player.publicKey,
          creator.player.publicKey,
          oracle.operator,
          overflowWinnerIndex,
          oracle.operatorKeypair
        ),
        "InvalidAmount",
        {
          fallbackSubstring: "Invalid config value",
          message: "accrue_fee should guard against fee_amount overflow",
        }
      );

      const finalGameToken = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(
        new anchor.BN(finalGameToken.feeAmount.toString()).eq(bigPrize)
      ).to.be.true;
    } finally {
      await updateOracleConfig(env, originalConfig);
      oracle.config.feePercentage = originalConfig.feePercentage;
    }
  }).timeout(120_000);
});
