import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  TestEnvironment,
  TestUtils,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  calculatePayoutBreakdown,
  coinflipGameConfig,
  expectAnchorError,
  gameTokenContextFromMint,
} from "./test-helpers";

// Ensures both legacy SPL Token and token-2022 mints exercise full game flows
// without triggering token-program specific regressions.
describe("Token program compatibility", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    env = TestEnvironment.getInstance();
    if (!env.oracle) {
      await env.initialize();
    }
    testUtils = env.testUtils ?? new TestUtils();
  });

  async function runCoinflipFlow(tokenProgram: anchor.web3.PublicKey) {
    const mint = await testUtils.mint.createMint({ tokenProgram });
    const creator = await testUtils.player.createPlayer(mint.mint);
    const challenger = await testUtils.player.createPlayer(mint.mint);

    const startingBalance = new anchor.BN(5_000_000);
    await testUtils.mint.mintTokensToAccount(
      mint,
      creator.playerTokenAccount.address,
      startingBalance
    );
    await testUtils.mint.mintTokensToAccount(
      mint,
      challenger.playerTokenAccount.address,
      startingBalance
    );

    const ticketAmount = new anchor.BN(1_000_000);
    const gameConfig = coinflipGameConfig({
      amount: ticketAmount,
      timeout: 600,
    });

    const gameData = await testUtils.game.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, creator.player);
    await testUtils.game.joinGame(gameData.gamePDA, challenger.player);

    const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      gameAccount.lastSlot.toNumber()
    );
    const players = [creator, challenger];
    const winner = getWinnerFromPlayers(players, winnerIndex);

    const winnerPre = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );

    const totalPot = ticketAmount.mul(new anchor.BN(players.length));
    const { fee: expectedFee, winnerAmount: expectedWinnerDelta } =
      calculatePayoutBreakdown(totalPot, env.oracle!.config.feePercentage);

    await testUtils.game.completeGame(
      gameData,
      winner.player.publicKey,
      creator.player.publicKey,
      env.oracle!.operator,
      winnerIndex,
      env.oracle!.operatorKeypair
    );

    const winnerPost = await env.provider.connection.getTokenAccountBalance(
      winner.playerTokenAccount.address
    );

    const delta = new anchor.BN(winnerPost.value.amount).sub(
      new anchor.BN(winnerPre.value.amount)
    );
    expect(delta.eq(expectedWinnerDelta)).to.be.true;

    const gameTokenAccount = await env.program.account.gameToken.fetch(
      mint.gameTokenPDA
    );
    expect(new anchor.BN(gameTokenAccount.feeAmount).eq(expectedFee)).to.be
      .true;
  }

  it("supports legacy spl-token mint flows", async () => {
    await runCoinflipFlow(TOKEN_PROGRAM_ID);
  });

  it("supports token-2022 mint flows", async () => {
    await runCoinflipFlow(TOKEN_2022_PROGRAM_ID);
  });

  it("rejects token-2022 mints with extensions", async () => {
    const payer = anchor.web3.Keypair.generate();
    const mint = anchor.web3.Keypair.generate();
    const mintLength = getMintLen([ExtensionType.TransferFeeConfig]);
    const rent =
      await env.provider.connection.getMinimumBalanceForRentExemption(
        mintLength
      );

    await env.provider.connection.confirmTransaction(
      await env.provider.connection.requestAirdrop(
        payer.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    await env.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: rent,
          space: mintLength,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferFeeConfigInstruction(
          mint.publicKey,
          payer.publicKey,
          payer.publicKey,
          100,
          1_000n,
          TOKEN_2022_PROGRAM_ID
        ),
        createInitializeMintInstruction(
          mint.publicKey,
          6,
          payer.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      ),
      [payer, mint]
    );

    const tokenMint = {
      mint: mint.publicKey,
      mintAuthority: payer,
      gameVaultPDA: anchor.web3.PublicKey.default,
      gameTokenPDA: anchor.web3.PublicKey.default,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      decimals: 6,
    };
    const context = gameTokenContextFromMint(tokenMint, env.program);

    await getOrCreateAssociatedTokenAccount(
      env.provider.connection,
      payer,
      mint.publicKey,
      context.gameVault,
      true,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    await expectAnchorError(
      env.program.methods
        .initializeToken({ minAmount: new anchor.BN(1_000), enabled: true })
        .accountsStrict({
          ...context,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: env.oracle!.operator,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc(),
      "UnsupportedTokenExtension"
    );
  });
});
