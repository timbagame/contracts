import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
  calculateWinnerIndex,
  getWinnerFromPlayers,
} from "./test-helpers";

// Negative authorization checks: non-creator close, non-operator withdraw/complete

describe("Authorization Negatives", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should reject close_game by non-creator", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator, other] = players;
    const gameData = testUtils.game.generateGamePDA();

    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );

    try {
      await env.program.methods
        .closeGame()
        .accounts({
          creator: other.player.publicKey,
          game: gameData.gamePDA,
          tokenMint: mint.mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([other.player])
        .rpc();
      expect.fail("Non-creator should not be able to close game");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidCreator");
    }
  });

  it("should reject withdraw_token_fee by non-operator", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;
    const gameData = testUtils.game.generateGamePDA();

    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const gm = await env.program.account.game.fetch(gameData.gamePDA);
    const idx = calculateWinnerIndex(
      gm.ticketsCount,
      gameData.secretKey,
      Number(gm.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, player1], idx);
    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      oracle.operator,
      idx
    );

    // Prepare fake operator with ATA
    const fakeOp = anchor.web3.Keypair.generate();
    const spl = await import("@solana/spl-token");
    // Airdrop lamports to fake operator to pay for ATA creation
    const sig = await env.provider.connection.requestAirdrop(
      fakeOp.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await env.provider.connection.confirmTransaction(sig, "confirmed");
    const fakeAta = await anchor.utils.token.associatedAddress({
      owner: fakeOp.publicKey,
      mint: mint.mint,
    });
    try {
      await env.provider.connection.getTokenAccountBalance(fakeAta);
    } catch {
      const ix = spl.createAssociatedTokenAccountInstruction(
        fakeOp.publicKey,
        fakeAta,
        fakeOp.publicKey,
        mint.mint
      );
      await env.provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [
        fakeOp,
      ]);
    }

    try {
      await env.program.methods
        .withdrawTokenFee()
        .accounts({
          tokenMint: mint.mint,
          oracleOperator: fakeOp.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fakeOp])
        .rpc();
      expect.fail("Non-operator should not be able to withdraw fees");
    } catch (e: any) {
      expect(e.toString()).to.include("UnauthorizedOperator");
    }
  });

  it("should reject complete_game by non-operator signer", async () => {
    const { mint, players } = await testUtils.quickSetup();
    const [creator, player1] = players;
    const gameData = testUtils.game.generateGamePDA();
    const cfg: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };
    await testUtils.game.initializeGame(
      gameData,
      cfg,
      creator.player,
      mint.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, player1.player);

    const gm = await env.program.account.game.fetch(gameData.gamePDA);
    const idx = calculateWinnerIndex(
      gm.ticketsCount,
      gameData.secretKey,
      Number(gm.lastSlot)
    );
    const winner = getWinnerFromPlayers([creator, player1], idx);

    const nonOp = anchor.web3.Keypair.generate();
    try {
      await env.program.methods
        .completeGame(gameData.randomHash, gameData.secretKey, idx)
        .accountsPartial({
          oracleOperator: nonOp.publicKey,
          winner: winner.player.publicKey,
          creator: creator.player.publicKey,
        })
        .signers([nonOp])
        .rpc();
      expect.fail("Non-operator should not complete game");
    } catch (e: any) {
      expect(e.toString()).to.include("UnauthorizedOperator");
    }
  });
});
