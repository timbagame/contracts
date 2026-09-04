import { beforeAll, describe, expect, test } from "bun:test";
import { address, type Address, type Instruction, type KeyPairSigner } from "@solana/kit";
import {
  TestEnvironment,
  TestUtils,
  buildSignedTransaction,
  calculatePayoutBreakdown,
  calculateWinnerIndex,
  coinflipGameConfig,
  ensureOperatorAta,
  errorToString,
  fetchTokenBalance,
  getWinnerFromPlayers,
  sendSignedTransaction,
  type TestGame,
} from "./test-helpers.ts";
import { fetchOracle } from "./generated/index.ts";

const MEMO_PROGRAM_ADDRESS = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function memoInstruction(value: string): Instruction {
  return {
    programAddress: MEMO_PROGRAM_ADDRESS,
    accounts: [],
    data: new TextEncoder().encode(value),
  };
}

async function buildSignedCompleteTx(
  env: TestEnvironment,
  testUtils: TestUtils,
  gameData: TestGame,
  winner: Address,
  creator: Address,
  oracleOperator: KeyPairSigner,
  winnerIndex: number,
  memoSeed: string,
) {
  const completeInstruction = await testUtils.game.buildCompleteGameInstruction(
    gameData,
    winner,
    creator,
    oracleOperator,
    winnerIndex,
  );
  return buildSignedTransaction(env.rpc, oracleOperator, [
    memoInstruction(`complete-race-${memoSeed}`),
    completeInstruction,
  ]);
}

type TxOutcome = { ok: true; signature: string } | { ok: false; error: Error };

async function sendTx(
  env: TestEnvironment,
  signed: Awaited<ReturnType<typeof buildSignedCompleteTx>>,
): Promise<TxOutcome> {
  try {
    const signature = await sendSignedTransaction(
      env.rpc,
      signed.transaction,
      signed.lastValidBlockHeight,
    );
    return { ok: true, signature };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

describe("Complete Game Race", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  beforeAll(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  test("settles exactly once when completion instructions race", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, challenger] = players;
    const gameData = await testUtils.game.createGame(
      coinflipGameConfig({ timeout: 120n }),
      creator.player,
      mint.mint,
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, challenger.player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot),
    );
    const winner = getWinnerFromPlayers([creator, challenger], winnerIndex);
    const operatorTokenAccount = await ensureOperatorAta(env, oracle, mint.mint);
    const [preWinnerBalance, preOperatorBalance] = await Promise.all([
      fetchTokenBalance(env.rpc, winner.playerTokenAccount),
      fetchTokenBalance(env.rpc, operatorTokenAccount),
    ]);
    const oracleAccount = await fetchOracle(env.rpc, oracle.oraclePDA, { commitment: "confirmed" });
    const { fee: expectedFee, winnerAmount: expectedWinnerAmount } = calculatePayoutBreakdown(
      gameAccount.totalAmount,
      oracleAccount.data.feePercentage,
    );
    const badIndex = (winnerIndex + 1) % gameAccount.ticketsCount;
    const [badTx, goodTx] = await Promise.all([
      buildSignedCompleteTx(
        env,
        testUtils,
        gameData,
        winner.player.address,
        creator.player.address,
        oracle.operatorKeypair,
        badIndex,
        "spoof",
      ),
      buildSignedCompleteTx(
        env,
        testUtils,
        gameData,
        winner.player.address,
        creator.player.address,
        oracle.operatorKeypair,
        winnerIndex,
        "valid",
      ),
    ]);
    const [badOutcome, goodOutcome] = await Promise.all([
      sendTx(env, badTx),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        return sendTx(env, goodTx);
      })(),
    ]);
    const successes = [badOutcome, goodOutcome].filter((outcome) => outcome.ok);
    const failures = [badOutcome, goodOutcome].filter((outcome) => !outcome.ok) as Array<{
      ok: false;
      error: Error;
    }>;
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    const failureMessage = errorToString(failures[0].error);
    expect(
      failureMessage.includes("WinnerIndexMismatch") ||
        failureMessage.includes("AccountNotInitialized") ||
        failureMessage.includes("7202") ||
        failureMessage.includes("3012"),
    ).toBe(true);

    const [postWinnerBalance, postOperatorBalance] = await Promise.all([
      fetchTokenBalance(env.rpc, winner.playerTokenAccount),
      fetchTokenBalance(env.rpc, operatorTokenAccount),
    ]);
    expect(postWinnerBalance - preWinnerBalance).toBe(expectedWinnerAmount);
    expect(postOperatorBalance - preOperatorBalance).toBe(expectedFee);
  });
});
