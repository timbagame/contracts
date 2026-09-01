import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import {
  TestEnvironment,
  TestUtils,
  coinflipGameConfig,
  calculateWinnerIndex,
  calculatePayoutBreakdown,
  getWinnerFromPlayers,
  ensureOperatorAta,
} from "./test-helpers.ts";
import type { TestGame } from "./test-helpers.ts";

const MEMO_PROGRAM_ID = new anchor.web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

async function buildSignedCompleteTx(
  env: TestEnvironment,
  testUtils: TestUtils,
  gameData: TestGame,
  winnerPublicKey: anchor.web3.PublicKey,
  creatorPublicKey: anchor.web3.PublicKey,
  oracleOperatorKeypair: anchor.web3.Keypair,
  winnerIndex: number,
  memoSeed: string,
): Promise<anchor.web3.Transaction> {
  const accounts = await testUtils.game.buildCompleteGameAccounts(
    gameData,
    winnerPublicKey,
    creatorPublicKey,
    oracleOperatorKeypair.publicKey,
  );

  const ix = await env.program.methods
    .completeGame(gameData.randomHash, gameData.secretKey, winnerIndex)
    .accountsStrict(accounts)
    .instruction();

  const { blockhash, lastValidBlockHeight } = await env.provider.connection.getLatestBlockhash();

  const tx = new anchor.web3.Transaction({
    feePayer: oracleOperatorKeypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  tx.add(
    new anchor.web3.TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(`complete-race-${memoSeed}`),
    }),
  );
  tx.add(ix);
  tx.sign(oracleOperatorKeypair);
  return tx;
}

type TxOutcome = { ok: true; signature: string } | { ok: false; error: Error };

async function sendTx(env: TestEnvironment, tx: anchor.web3.Transaction): Promise<TxOutcome> {
  const serialized = tx.serialize();
  try {
    const signature = await env.provider.connection.sendRawTransaction(serialized, {
      skipPreflight: false,
    });
    const confirmation = await env.provider.connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) {
      return {
        ok: false,
        error: new Error(
          `Transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`,
        ),
      };
    }
    return { ok: true, signature };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

describe("Complete Game Race", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("settles exactly once when completion instructions race", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, challenger] = players;

    const gameConfig = coinflipGameConfig({ timeout: new anchor.BN(120) });

    const gameData = await testUtils.game.createGame(gameConfig, creator.player, mint.mint);

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, challenger.player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);

    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot),
    );
    const participants = [creator, challenger];
    const winner = getWinnerFromPlayers(participants, winnerIndex);

    const preWinnerBalance = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address,
    );
    const feeRecipientTokenAccount = await ensureOperatorAta(
      env.provider.connection,
      oracle,
      mint.mint,
    );
    const preFeeRecipientBalance =
      await env.provider.connection.getTokenAccountBalance(feeRecipientTokenAccount);

    const totalPot = new anchor.BN(gameAccount.totalAmount.toString());
    const { fee: expectedFee, winnerAmount: expectedWinnerAmount } = calculatePayoutBreakdown(
      totalPot,
      gameAccount.feePercentage,
    );

    const badIndex = (winnerIndex + 1) % gameAccount.ticketsCount;

    const badTxPromise = buildSignedCompleteTx(
      env,
      testUtils,
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operatorKeypair,
      badIndex,
      "spoof",
    );

    const goodTxPromise = buildSignedCompleteTx(
      env,
      testUtils,
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operatorKeypair,
      winnerIndex,
      "valid",
    );

    const [badTx, goodTx] = await Promise.all([badTxPromise, goodTxPromise]);

    const [badOutcome, goodOutcome] = await Promise.all([
      sendTx(env, badTx),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        return sendTx(env, goodTx);
      })(),
    ]);

    const outcomes = [badOutcome, goodOutcome];
    const successes = outcomes.filter((o) => o.ok);
    const failures = outcomes.filter((o) => !o.ok) as Array<{
      ok: false;
      error: Error;
    }>;

    expect(successes.length).to.equal(1);
    expect(failures.length).to.equal(1);

    const failureMessage = failures[0].error.toString();
    expect(
      failureMessage.includes("WinnerIndexMismatch") ||
        failureMessage.includes("AccountNotInitialized"),
    ).to.be.true;

    const postWinnerBalance = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address,
    );
    const winnerDelta = new anchor.BN(postWinnerBalance.value.amount).sub(
      new anchor.BN(preWinnerBalance.value.amount),
    );
    expect(winnerDelta.eq(expectedWinnerAmount)).to.be.true;

    const gameInfo = await env.provider.connection.getAccountInfo(gameData.gamePDA);
    expect(gameInfo).to.be.null;

    const postFeeRecipientBalance =
      await env.provider.connection.getTokenAccountBalance(feeRecipientTokenAccount);
    const feeDelta = new anchor.BN(postFeeRecipientBalance.value.amount).sub(
      new anchor.BN(preFeeRecipientBalance.value.amount),
    );
    expect(feeDelta.eq(expectedFee)).to.be.true;
  }).timeout(180_000);
});
