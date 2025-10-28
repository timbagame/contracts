import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  deriveGameAccounts,
  toGameTokenContext,
  awaitBufferExpiry,
  coinflipGameConfig,
  getOraclePublicKey,
} from "./test-helpers";

// Tests closing a game after timeout when min tickets not reached and players unjoin

describe("Incomplete Game Close", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should allow players to unjoin after buffer then creator closes game", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, p1, p2] = players;

    const gameConfig = coinflipGameConfig({
      maxTickets: 5,
      minTickets: 4, // Will not reach
      timeout: 5, // short
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, p1.player);
    await testUtils.game.joinGame(gameData.gamePDA, p2.player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    await awaitBufferExpiry(gameAccount, oracle.config);

    // Unjoin all players
    for (const pl of [creator, p1, p2]) {
      await testUtils.game.unjoinGame(gameData.gamePDA, pl.player);
    }

    const gameAfterUnjoins = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameAfterUnjoins.ticketsCount).to.equal(0);
    expect(gameAfterUnjoins.totalAmount.toNumber()).to.equal(0);

    const oraclePubkey = getOraclePublicKey(oracle);

    const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
      player: creator.player.publicKey,
      tokenMint: mint.mint,
    });
    if (!derived.playerTokenAccount) {
      throw new Error(
        "Missing creator token account for incomplete close test"
      );
    }

    // Close game (refund not applicable since not giveaway)
    await env.program.methods
      .closeGame()
      .accountsStrict({
        game: gameData.gamePDA,
        creator: creator.player.publicKey,
        oracle: oraclePubkey,
        gameTokenCtx: toGameTokenContext(derived),
        creatorTokenAccount: derived.playerTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator.player])
      .rpc();
  }).timeout(60000);
});
