import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  calculateWinnerIndex,
  getWinnerFromPlayers,
} from "./test-helpers";

async function waitForClusterTimestamp(
  connection: anchor.web3.Connection,
  targetTimestamp: number,
  pollIntervalMs = 200
): Promise<void> {
  const deadline = Date.now() + 60_000; // safety timeout
  while (Date.now() < deadline) {
    const clockAccount = await connection.getAccountInfo(
      anchor.web3.SYSVAR_CLOCK_PUBKEY
    );
    if (!clockAccount) {
      throw new Error("Clock sysvar account not available");
    }

    const currentTimestamp = Number(clockAccount.data.readBigInt64LE(32));
    if (currentTimestamp >= targetTimestamp) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timeout waiting for cluster timestamp ${targetTimestamp} to be reached`
  );
}

// When the oracle buffer is set to zero, games that rely on timeouts should
// still be completable the moment the timeout is reached.

describe("Zero Buffer Timeout Completion", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("should allow oracle completion once timeout passes with zero buffer", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;
    const gameData = testUtils.game.generateGamePDA();

    const originalConfig = { ...oracle.config };

    const zeroBufferConfig = {
      feePercentage: oracle.config.feePercentage,
      oracleBufferTime: new anchor.BN(0),
      maxTickets: oracle.config.maxTickets,
      maxTimeout: new anchor.BN(oracle.config.maxTimeout),
      minTimeout: new anchor.BN(oracle.config.minTimeout),
    };

    const restoreOracleConfig = async () => {
      await env.program.methods
        .updateOracle({
          feePercentage: originalConfig.feePercentage,
          oracleBufferTime: new anchor.BN(originalConfig.oracleBufferTime),
          maxTickets: originalConfig.maxTickets,
          maxTimeout: new anchor.BN(originalConfig.maxTimeout),
          minTimeout: new anchor.BN(originalConfig.minTimeout),
        })
        .accounts({
          oldOracleOperator: oracle.operator,
          newOracleOperator: oracle.operator,
        })
        .signers([oracle.operatorKeypair])
        .rpc();
    };

    await env.program.methods
      .updateOracle(zeroBufferConfig)
      .accounts({
        oldOracleOperator: oracle.operator,
        newOracleOperator: oracle.operator,
      })
      .signers([oracle.operatorKeypair])
      .rpc();

    try {
      const ticketAmount = new anchor.BN(1_500_000);
      const timeoutSeconds = 3;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: ticketAmount,
        maxTickets: new anchor.BN(4),
        minTickets: new anchor.BN(2),
        timeout: new anchor.BN(timeoutSeconds),
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

      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );

      const createdAt =
        typeof gameAccount.createdAt === "number"
          ? gameAccount.createdAt
          : gameAccount.createdAt.toNumber();
      const targetTimestamp = createdAt + timeoutSeconds;

      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      const totalPot = ticketAmount.mul(new anchor.BN(2));
      const expectedFee = totalPot
        .mul(new anchor.BN(originalConfig.feePercentage))
        .div(new anchor.BN(100));
      const expectedWinnerAmount = totalPot.sub(expectedFee);

      const preWinnerBalance =
        await env.provider.connection.getTokenAccountBalance(
          winner.playerTokenAccount.address
        );

      await waitForClusterTimestamp(
        env.provider.connection,
        targetTimestamp
      );

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      const postWinnerBalance =
        await env.provider.connection.getTokenAccountBalance(
          winner.playerTokenAccount.address
        );
      const balanceDelta = new anchor.BN(postWinnerBalance.value.amount).sub(
        new anchor.BN(preWinnerBalance.value.amount)
      );

      expect(balanceDelta.eq(expectedWinnerAmount)).to.be.true;
    } finally {
      await restoreOracleConfig().catch(() => {});
    }
  }).timeout(120000);
});
