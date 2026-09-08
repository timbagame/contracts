import { beforeAll, describe, expect, test } from "bun:test";
import { address, type Address, type Instruction, type KeyPairSigner } from "@solana/kit";
import {
  TestEnvironment,
  TestUtils,
  awaitOracleCompletionReady,
  buildSignedTransaction,
  coinflipGameConfig,
  expectProgramError,
  fetchTokenBalance,
  sendSignedTransaction,
} from "./test-helpers.ts";

const MEMO_PROGRAM_ADDRESS = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function memoInstruction(value: string): Instruction {
  return {
    programAddress: MEMO_PROGRAM_ADDRESS,
    accounts: [],
    data: new TextEncoder().encode(value),
  };
}

async function buildSignedUnjoinTx(
  env: TestEnvironment,
  testUtils: TestUtils,
  game: Address,
  player: KeyPairSigner,
  uniqueSeed: number,
) {
  const instruction = await testUtils.game.buildUnjoinGameInstruction(game, player);
  return buildSignedTransaction(
    env.rpc,
    player,
    uniqueSeed === 0 ? [instruction] : [memoInstruction(`race-${uniqueSeed}`), instruction],
  );
}

describe("Unjoin Race Conditions", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  test("settles exactly once when two unjoin attempts race", async () => {
    const { mint, players, oracle } = await testUtils.quickSetup();
    const [creator, participant] = players;
    const ticketAmount = 1_200_000n;
    const gameData = await testUtils.game.createGame(
      coinflipGameConfig({ amount: ticketAmount, timeout: 2n, minTickets: 3, maxTickets: 3 }),
      creator.player,
      mint.mint,
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, participant.player);
    await awaitOracleCompletionReady(
      await testUtils.game.fetchGame(gameData.gamePDA),
      oracle.config,
    );

    const balanceBefore = await fetchTokenBalance(env.rpc, participant.playerTokenAccount);
    const [txA, txB] = await Promise.all([
      buildSignedUnjoinTx(env, testUtils, gameData.gamePDA, participant.player, 0),
      buildSignedUnjoinTx(env, testUtils, gameData.gamePDA, participant.player, 1),
    ]);
    const sendTx = async (signed: Awaited<ReturnType<typeof buildSignedUnjoinTx>>) => {
      try {
        return {
          ok: true as const,
          signature: await sendSignedTransaction(
            env.rpc,
            signed.transaction,
            signed.lastValidBlockHeight,
          ),
        };
      } catch (error) {
        return { ok: false as const, error };
      }
    };
    const [resA, resB] = await Promise.all([sendTx(txA), sendTx(txB)]);
    const successes = [resA, resB].filter((result) => result.ok);
    const failures = [resA, resB].filter((result) => !result.ok);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((await fetchTokenBalance(env.rpc, participant.playerTokenAccount)) - balanceBefore).toBe(
      ticketAmount,
    );
    expect((await testUtils.game.fetchGame(gameData.gamePDA)).ticketsCount).toBe(1);
    for (const failure of failures) {
      await expectProgramError(Promise.reject(failure.error), "ParticipantNotFound");
    }
  });
});
