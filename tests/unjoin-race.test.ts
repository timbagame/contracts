import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  coinflipGameConfig,
  deriveGameAccounts,
  expectAnchorError,
  toGameTokenContext,
} from "./test-helpers";

const MEMO_PROGRAM_ID = new anchor.web3.PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

async function buildSignedUnjoinTx(
  env: TestEnvironment,
  game: anchor.web3.PublicKey,
  player: anchor.web3.Keypair,
  tokenMint: anchor.web3.PublicKey,
  uniqueSeed: number
): Promise<anchor.web3.Transaction> {
  const derived = await deriveGameAccounts(env.program, game, {
    player: player.publicKey,
    tokenMint,
  });

  if (!derived.playerTokenAccount) {
    throw new Error("Missing player token account for unjoin race test");
  }

  const ix = await env.program.methods
    .unjoinGame()
    .accountsStrict({
      game,
      player: player.publicKey,
      authority: player.publicKey,
      oracle: derived.oracle,
      playerTokenAccount: derived.playerTokenAccount,
      gameTokenCtx: toGameTokenContext(derived),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .instruction();

  const { blockhash, lastValidBlockHeight } =
    await env.provider.connection.getLatestBlockhash();

  const tx = new anchor.web3.Transaction({
    feePayer: player.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  if (uniqueSeed !== 0) {
    tx.add(
      new anchor.web3.TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        data: Buffer.from(`race-${uniqueSeed}`),
      })
    );
  }

  tx.add(ix);
  tx.sign(player);
  return tx;
}

describe("Unjoin Race Conditions", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) {
      await env.initialize();
    }
  });

  it("settles exactly once when two unjoin attempts race", async () => {
    const setup = await testUtils.quickSetup();
    const { mint, players } = setup;
    const [creator, participant] = players;

    const ticketAmount = new anchor.BN(1_200_000);
    const gameConfig = coinflipGameConfig({
      amount: ticketAmount,
      timeout: 240,
      minTickets: 3,
      maxTickets: 3,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, participant.player);

    const balanceBefore = await env.provider.connection.getTokenAccountBalance(
      participant.playerTokenAccount.address
    );

    const [txA, txB] = await Promise.all([
      buildSignedUnjoinTx(env, gameData.gamePDA, participant.player, mint.mint, 0),
      buildSignedUnjoinTx(env, gameData.gamePDA, participant.player, mint.mint, 1),
    ]);

    const sendTx = async (tx: anchor.web3.Transaction) => {
      const serialized = tx.serialize();
      try {
        const signature = await env.provider.connection.sendRawTransaction(
          serialized,
          {
            skipPreflight: false,
          }
        );
        const confirmation = await env.provider.connection.confirmTransaction(
          signature,
          "confirmed"
        );
        if (confirmation.value.err) {
          const errorMessage = JSON.stringify(confirmation.value.err);
          return {
            ok: false as const,
            error: new Error(
              `Transaction ${signature} failed: ${errorMessage}`
            ),
          };
        }
        return { ok: true as const, signature };
      } catch (error) {
        return { ok: false, error } as const;
      }
    };

    const [resA, resB] = await Promise.all([sendTx(txA), sendTx(txB)]);
    const outcomes = [resA, resB];
    const successes = outcomes.filter((result) => result.ok);
    const failures = outcomes.filter((result) => !result.ok);

    expect(successes.length).to.equal(1);
    expect(failures.length).to.equal(1);

    const balanceAfter = await env.provider.connection.getTokenAccountBalance(
      participant.playerTokenAccount.address
    );

    const delta = new anchor.BN(balanceAfter.value.amount).sub(
      new anchor.BN(balanceBefore.value.amount)
    );
    expect(delta.eq(ticketAmount)).to.be.true;

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAccount.ticketsCount).to.equal(1);

    for (const failure of failures) {
      await expectAnchorError(Promise.reject(failure.error), "UnauthorizedPlayer", {
        fallbackSubstring: '"Custom":7001',
      });
    }
  }).timeout(180_000);
});
