import * as anchor from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
  TestEnvironment,
  TestUtils,
  coinflipGameConfig,
  expectAnchorError,
  gameTokenContextFromMint,
  getOraclePublicKey,
  calculateWinnerIndex,
  getWinnerFromPlayers,
} from "./test-helpers";

// Ensures InvalidTokenMint guard is enforced across game flows

describe("Invalid token mint guard", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    if (!env.oracle) {
      await env.initialize();
    }
    testUtils = env.testUtils ?? new TestUtils();
  });

  it("rejects joinGame when game token context mint mismatches", async () => {
    const mintA = await testUtils.mint.createMint();
    const mintB = await testUtils.mint.createMint();

    const creator = await testUtils.player.createPlayer(mintA.mint);
    const mismatchedPlayer = await testUtils.player.createPlayer(mintB.mint);

    const gameConfig = coinflipGameConfig();
    const ticketAmount = gameConfig.amount as anchor.BN;

    const gameData = testUtils.game.generateGamePDA();
    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mintA.mint
    );
    await testUtils.game.joinGame(gameData.gamePDA, creator.player);

    await testUtils.mint.mintTokensToAccount(
      mintB,
      mismatchedPlayer.playerTokenAccount.address,
      ticketAmount
    );

    const mismatchedContext = gameTokenContextFromMint(mintB, env.program);

    await expectAnchorError(
      env.program.methods
        .joinGame()
        .accountsStrict({
          game: gameData.gamePDA,
          player: mismatchedPlayer.player.publicKey,
          oracleOperator: env.oracle!.operator,
          playerTokenAccount: mismatchedPlayer.playerTokenAccount.address,
          gameTokenCtx: mismatchedContext,
          oracle: getOraclePublicKey(env.oracle!),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([mismatchedPlayer.player, env.oracle!.operatorKeypair])
        .rpc(),
      "InvalidTokenMint"
    );
  });

  it("rejects completeGame when provided mint differs from game state", async () => {
    const mintA = await testUtils.mint.createMint();
    const mintB = await testUtils.mint.createMint();

    const creator = await testUtils.player.createPlayer(mintA.mint);
    const challenger = await testUtils.player.createPlayer(mintA.mint);

    const startingBalance = new anchor.BN(5_000_000);
    await testUtils.mint.mintTokensToAccount(
      mintA,
      creator.playerTokenAccount.address,
      startingBalance
    );
    await testUtils.mint.mintTokensToAccount(
      mintA,
      challenger.playerTokenAccount.address,
      startingBalance
    );

    const gameConfig = coinflipGameConfig();
    const gameData = testUtils.game.generateGamePDA();

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mintA.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, challenger.player);

    const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      gameAccount.lastSlot.toNumber()
    );
    const players = [creator, challenger];
    const winner = getWinnerFromPlayers(players, winnerIndex);

    const mismatchedContext = gameTokenContextFromMint(mintB, env.program);

    const winnerTokenAccount = await getOrCreateAssociatedTokenAccount(
      env.provider.connection,
      winner.player,
      mintB.mint,
      winner.player.publicKey,
      undefined,
      undefined,
      undefined,
      mintB.tokenProgram
    );

    await expectAnchorError(
      testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        env.oracle!.operator,
        winnerIndex,
        env.oracle!.operatorKeypair,
        {
          gameTokenCtx: mismatchedContext,
          winnerTokenAccount: winnerTokenAccount.address,
        }
      ),
      "InvalidTokenMint"
    );
  });

  it("rejects unjoinGame when supplied mint does not match", async () => {
    const mintA = await testUtils.mint.createMint();
    const mintB = await testUtils.mint.createMint();

    const creator = await testUtils.player.createPlayer(mintA.mint);
    const joiner = await testUtils.player.createPlayer(mintA.mint);

    const startingBalance = new anchor.BN(5_000_000);
    await testUtils.mint.mintTokensToAccount(
      mintA,
      creator.playerTokenAccount.address,
      startingBalance
    );
    await testUtils.mint.mintTokensToAccount(
      mintA,
      joiner.playerTokenAccount.address,
      startingBalance
    );

    const gameConfig = coinflipGameConfig();
    const gameData = testUtils.game.generateGamePDA();

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      creator.player,
      mintA.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, joiner.player);

    const mismatchedContext = gameTokenContextFromMint(mintB, env.program);
    const mismatchedPlayerTokenAccount = await getOrCreateAssociatedTokenAccount(
      env.provider.connection,
      joiner.player,
      mintB.mint,
      joiner.player.publicKey,
      undefined,
      undefined,
      undefined,
      mintB.tokenProgram
    );

    await expectAnchorError(
      env.program.methods
        .unjoinGame()
        .accountsStrict({
          game: gameData.gamePDA,
          player: joiner.player.publicKey,
          authority: joiner.player.publicKey,
          oracle: getOraclePublicKey(env.oracle!),
          gameTokenCtx: mismatchedContext,
          playerTokenAccount: mismatchedPlayerTokenAccount.address,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([joiner.player])
        .rpc(),
      "InvalidTokenMint"
    );
  });
});
