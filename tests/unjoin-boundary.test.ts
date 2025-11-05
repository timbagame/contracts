import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  coinflipGameConfig,
  getClockUnixTimestamp,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  expectAnchorError,
} from "./test-helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForExactTimestamp(
  connection: anchor.web3.Connection,
  targetTimestamp: number,
  { pollMs = 40, maxDriftSeconds = 1 }: { pollMs?: number; maxDriftSeconds?: number } = {}
): Promise<void> {
  while (true) {
    const current = await getClockUnixTimestamp(connection);

    if (current === targetTimestamp) {
      return;
    }

    if (current > targetTimestamp) {
      const drift = current - targetTimestamp;
      if (drift <= maxDriftSeconds) {
        return;
      }
      throw new Error(`Missed target timestamp by ${drift} seconds`);
    }

    await sleep(pollMs);
  }
}

describe("Unjoin Buffer Boundary", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("allows unjoin exactly at oracle buffer expiry second", async () => {
    const setup = await testUtils.quickSetup();
    const { oracle, mint, players } = setup;
    const [creator, participant] = players;

    if (oracle.config.oracleBufferTime <= 0) {
      // Safety guard: this suite expects strictly positive buffer time.
      throw new Error("Oracle buffer time must be positive for boundary test");
    }

    const timeoutSeconds = 4;
    const ticketAmount = new anchor.BN(1_500_000);

    const gameConfig = coinflipGameConfig({
      timeout: timeoutSeconds,
      maxTickets: 2,
      minTickets: 2,
      amount: ticketAmount,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, participant.player);

  const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);

    const createdAtSeconds = gameAccount.createdAt.toNumber();
    const timeoutSecondsValue = (gameConfig.timeout as anchor.BN).toNumber();

    const targetTimestamp =
      createdAtSeconds + timeoutSecondsValue + oracle.config.oracleBufferTime;

    const connection = env.provider.connection;
    const now = await getClockUnixTimestamp(connection);

    const leadTime = targetTimestamp - now - 1;
    if (leadTime > 0) {
      await sleep(leadTime * 1_000);
    }

    await waitForExactTimestamp(connection, targetTimestamp);

    const boundarySnapshot = await testUtils.game.fetchGame(gameData.gamePDA);
    const participants = [creator, participant];
    const winnerIndex = calculateWinnerIndex(
      boundarySnapshot.ticketsCount,
      gameData.secretKey,
      Number(boundarySnapshot.lastSlot)
    );
    const deterministicWinner = getWinnerFromPlayers(participants, winnerIndex);

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        deterministicWinner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      ),
      "GameNotReadyForOracle",
      {
        fallbackSubstring: "Oracle not ready",
        message: "Completion should be blocked exactly at buffer expiry",
      }
    );

    const balanceBefore = await connection.getTokenAccountBalance(
      participant.playerTokenAccount.address
    );

    await testUtils.game.unjoinGame(gameData.gamePDA, participant.player);

    const balanceAfter = await connection.getTokenAccountBalance(
      participant.playerTokenAccount.address
    );

    const received = new anchor.BN(balanceAfter.value.amount).sub(
      new anchor.BN(balanceBefore.value.amount)
    );
    expect(received.eq(ticketAmount)).to.be.true;

    const updated = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(updated.ticketsCount).to.equal(1);
    expect(updated.participantHashes.length).to.equal(1);
  }).timeout(120_000);
});
