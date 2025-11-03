import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  deriveGameAccounts,
  toGameTokenContext,
  awaitBufferExpiry,
  awaitOracleCompletionReady,
  giveawayGameConfig,
  getOraclePublicKey,
  expectAnchorError,
} from "./test-helpers";

// Verifies that closing an unused giveaway refunds the prize to creator

describe("Giveaway Close Refund", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    if (!env.oracle) await env.initialize();
  });

  it("should fail giveaway initialization when creator lacks prize balance", async () => {
    const { mint } = await testUtils.quickSetup();
    const unfundedCreator = await testUtils.player.createPlayer(mint.mint);

    const prizeAmount = new anchor.BN(5_000_000);
    const gameConfig = giveawayGameConfig({
      amount: prizeAmount,
      maxTickets: 5,
      timeout: 45,
    });

    const gameData = testUtils.game.generateGamePDA();

    await expectAnchorError(
      testUtils.game.initializeGame(
        gameData,
        gameConfig,
        unfundedCreator.player,
        mint.mint
      ),
      "InsufficientFunds",
      {
        fallbackSubstring: "insufficient funds",
        message: "Giveaway init should fail without prize balance",
      }
    );

    const maybeGame = await env.provider.connection.getAccountInfo(
      gameData.gamePDA
    );
    expect(maybeGame).to.be.null;
  }).timeout(60000);

  it("should refund full prize to creator when closing unused giveaway", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator] = players;

    const prizeAmount = new anchor.BN(5_000_000);

    const gameConfig = giveawayGameConfig({
      amount: prizeAmount, // total prize
      maxTickets: 10,
      timeout: 30, // short timeout
    });

    // Record creator balance before funding
    const beforeBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    // Balance decreased by prizeAmount (since total_amount funded at creation)
    const midBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );
    expect(
      new anchor.BN(beforeBal.value.amount)
        .sub(new anchor.BN(midBal.value.amount))
        .eq(prizeAmount)
    ).to.be.true;

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);

    await awaitBufferExpiry(gameAccount, oracle.config);

    // Close game (no joins happened)
    const oraclePubkey = getOraclePublicKey(oracle);

    const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
      player: creator.player.publicKey,
      tokenMint: mint.mint,
    });
    if (!derived.playerTokenAccount) {
      throw new Error("Missing creator token account for giveaway close test");
    }

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

    // Creator should be refunded full prize
    const afterBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    expect(
      new anchor.BN(afterBal.value.amount).eq(
        new anchor.BN(beforeBal.value.amount)
      )
    ).to.be.true;
  }).timeout(45000);

  it("should allow closing a giveaway with active players once the buffer expires", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, participant] = players;

    const prizeAmount = new anchor.BN(4_000_000);
    const timeoutSeconds = 3;

    const gameConfig = giveawayGameConfig({
      amount: prizeAmount,
      maxTickets: 5,
      timeout: timeoutSeconds,
    });

    const beforeBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, participant.player);

    const gameBeforeClose = await testUtils.game.fetchGame(gameData.gamePDA);
    expect(gameBeforeClose.ticketsCount).to.equal(1);

    await awaitBufferExpiry(gameBeforeClose, oracle.config, 1);

    const secondOraclePubkey = getOraclePublicKey(oracle);

    const secondDerived = await deriveGameAccounts(
      env.program,
      gameData.gamePDA,
      {
        player: creator.player.publicKey,
        tokenMint: mint.mint,
      }
    );
    if (!secondDerived.playerTokenAccount) {
      throw new Error("Missing creator token account for giveaway buffer test");
    }

    await env.program.methods
      .closeGame()
      .accountsStrict({
        game: gameData.gamePDA,
        creator: creator.player.publicKey,
        oracle: secondOraclePubkey,
        gameTokenCtx: toGameTokenContext(secondDerived),
        creatorTokenAccount: secondDerived.playerTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator.player])
      .rpc();

    const afterBal = await env.provider.connection.getTokenAccountBalance(
      creator.playerTokenAccount.address
    );

    expect(
      new anchor.BN(afterBal.value.amount).eq(
        new anchor.BN(beforeBal.value.amount)
      )
    ).to.be.true;
  }).timeout(90000);

  it("should reject closing a giveaway while still waiting for oracle", async () => {
    const { oracle, mint, players } = await testUtils.quickSetup();
    const [creator, participant] = players;

    const prizeAmount = new anchor.BN(3_500_000);
    const timeoutSeconds = 4;

    const gameConfig = giveawayGameConfig({
      amount: prizeAmount,
      maxTickets: 5,
      timeout: timeoutSeconds,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, participant.player);

    const beforeClose = await testUtils.game.fetchGame(gameData.gamePDA);

    await awaitOracleCompletionReady(beforeClose, oracle.config);

    const oraclePubkey = getOraclePublicKey(oracle);

    const derived = await deriveGameAccounts(env.program, gameData.gamePDA, {
      player: creator.player.publicKey,
      tokenMint: mint.mint,
    });
    if (!derived.playerTokenAccount) {
      throw new Error("Missing creator token account for giveaway waiting test");
    }

    await expectAnchorError(
      env.program.methods
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
        .rpc(),
      "GameWaitingForOracle",
      { fallbackSubstring: "Awaiting oracle" }
    );
  }).timeout(90000);
});
