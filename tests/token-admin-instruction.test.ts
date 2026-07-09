import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  MintManager,
  PlayerManager,
  GameManager,
  TestEnvironment,
  coinflipGameConfig,
  computeGameTokenContext,
  expectAnchorError,
  captureEvent,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  errorToString,
} from "./test-helpers";

// Instruction coverage for initialize_token and update_token flows

describe("Token Administration Instructions", () => {
  let env: TestEnvironment;
  let mintManager: MintManager;

  before(async () => {
    env = TestEnvironment.getInstance();
    if (!env.oracle) {
      await env.initialize();
    }
    // Use standalone MintManager so tests can mint without touching global helpers
    mintManager = new MintManager(env.program, env.provider);
  });

  it("should emit TokenInitialized event with expected payload", async () => {
    let mint: any;
    const event = await captureEvent(
      env.program,
      "tokenInitialized",
      async () => {
        mint = await mintManager.createMint();
      }
    );

    const createdMint = mint;
    const gameTokenAccount = await env.program.account.gameToken.fetch(
      createdMint.gameTokenPDA
    );

    const expectedMinAmount = gameTokenAccount.minAmount.toNumber();

    expect(event.tokenMint).to.deep.equal(createdMint.mint);
    expect(Number(event.minAmount)).to.equal(expectedMinAmount);
    expect(event.enabled).to.equal(true);

    expect(gameTokenAccount.tokenMint.equals(createdMint.mint)).to.be.true;
    expect(gameTokenAccount.minAmount.toNumber()).to.equal(expectedMinAmount);
    expect(gameTokenAccount.enabled).to.equal(true);
  });

  it("should reject initialize_token when caller is not oracle operator", async () => {
    const connection = env.provider.connection;

    const fakeOperator = anchor.web3.Keypair.generate();
    const mintAuthority = anchor.web3.Keypair.generate();

    // Fund fake operator and mint authority for rent/fees
    const airdrops = await Promise.all([
      connection.requestAirdrop(
        fakeOperator.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      connection.requestAirdrop(
        mintAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      ),
    ]);
    await Promise.all(
      airdrops.map((sig) => connection.confirmTransaction(sig, "confirmed"))
    );

    const mint = await createMint(
      connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      env.program.programId
    );
    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), mint.toBuffer()],
      env.program.programId
    );

    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      fakeOperator,
      mint,
      gameVaultPDA,
      true
    );

    try {
      await env.program.methods
        .initializeToken({ minAmount: new anchor.BN(10_000), enabled: true })
        .accountsStrict({
          gameToken: gameTokenPDA,
          tokenMint: mint,
          gameVault: gameVaultPDA,
          gameTokenAccount: vaultAta.address,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: fakeOperator.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([fakeOperator])
        .rpc();
      expect.fail("Expected initialize_token to reject unauthorized operator");
    } catch (e: any) {
      expect(e.toString()).to.include("UnauthorizedOperator");
    }
  });

  it("should reject initialize_token when token program account is invalid", async () => {
    const connection = env.provider.connection;

    const mintAuthority = anchor.web3.Keypair.generate();
    const fakeTokenProgram = anchor.web3.Keypair.generate();

    const airdrops = await Promise.all([
      connection.requestAirdrop(
        mintAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      ),
      connection.requestAirdrop(
        fakeTokenProgram.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      ),
    ]);
    await Promise.all(
      airdrops.map((sig) => connection.confirmTransaction(sig, "confirmed"))
    );

    const mint = await createMint(
      connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    const { gameToken, gameVault, gameTokenAccount } = computeGameTokenContext(
      env.program,
      mint,
      TOKEN_PROGRAM_ID
    );

    await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      gameVault,
      true
    );

    await expectAnchorError(
      env.program.methods
        .initializeToken({ minAmount: new anchor.BN(5_000), enabled: true })
        .accountsStrict({
          gameToken,
          tokenMint: mint,
          gameVault,
          gameTokenAccount,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: env.oracle!.operator,
          systemProgram: SystemProgram.programId,
          tokenProgram: fakeTokenProgram.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc(),
      "InvalidProgramId"
    );
  });

  it("should reject update_token when signer is not oracle operator", async () => {
    const mint = await mintManager.createMint();
    const fakeOperator = anchor.web3.Keypair.generate();

    const connection = env.provider.connection;
    const sig = await connection.requestAirdrop(
      fakeOperator.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    try {
      await env.program.methods
        .updateToken({ minAmount: new anchor.BN(99_999), enabled: false })
        .accountsStrict({
          gameToken: mint.gameTokenPDA,
          tokenMint: mint.mint,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: fakeOperator.publicKey,
        })
        .signers([fakeOperator])
        .rpc();
      expect.fail("Expected update_token to reject unauthorized operator");
    } catch (e: any) {
      expect(e.toString()).to.include("UnauthorizedOperator");
    }
  });

  it("should reject update_token when token mint does not match game token", async () => {
    const primaryMint = await mintManager.createMint();
    const mismatchedMint = await mintManager.createMint();

    // Anchor validates PDA seeds before applying the InvalidTokenMint account constraint,
    // so a mismatched mint surfaces as a ConstraintSeeds failure at the framework level.
    await expectAnchorError(
      env.program.methods
        .updateToken({ minAmount: new anchor.BN(77_777), enabled: true })
        .accountsStrict({
          gameToken: primaryMint.gameTokenPDA,
          tokenMint: mismatchedMint.mint,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: env.oracle!.operator,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc(),
      "ConstraintSeeds"
    );
  });

  it("should emit TokenUpdated when configuration changes", async () => {
    const mint = await mintManager.createMint();

    const newMinAmount = new anchor.BN(42_000);

    try {
      const event = await captureEvent(
        env.program,
        "tokenUpdated",
        async () => {
          await env.program.methods
            .updateToken({ minAmount: newMinAmount, enabled: false })
            .accounts({
              tokenMint: mint.mint,
              oracleOperator: env.oracle!.operator,
            })
            .signers([env.oracle!.operatorKeypair])
            .rpc();
        }
      );

      expect(event.tokenMint).to.deep.equal(mint.mint);
      expect(Number(event.minAmount)).to.equal(newMinAmount.toNumber());
      expect(event.enabled).to.equal(false);

      const onChain = await env.program.account.gameToken.fetch(
        mint.gameTokenPDA
      );
      expect(onChain.minAmount.toNumber()).to.equal(newMinAmount.toNumber());
      expect(onChain.enabled).to.equal(false);
    } finally {
      await env.program.methods
        .updateToken({ minAmount: new anchor.BN(1000), enabled: true })
        .accounts({
          tokenMint: mint.mint,
          oracleOperator: env.oracle!.operator,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc();
    }
  });

  it("should surface InvalidProgramId before unsupported token guard", async () => {
    const connection = env.provider.connection;
    const mintAuthority = anchor.web3.Keypair.generate();

    const airdropSig = await connection.requestAirdrop(
      mintAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    const mint = await createMint(
      connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      env.program.programId
    );
    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), mint.toBuffer()],
      env.program.programId
    );

    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      gameVaultPDA,
      true
    );

    // The token interface enforces program identity ahead of the UnsupportedTokenProgram
    // guard, leading Anchor to raise InvalidProgramId when an arbitrary program ID is used.
    await expectAnchorError(
      env.program.methods
        .initializeToken({ minAmount: new anchor.BN(5_000), enabled: true })
        .accountsStrict({
          gameToken: gameTokenPDA,
          tokenMint: mint,
          gameVault: gameVaultPDA,
          gameTokenAccount: vaultAta.address,
          oracle: env.oracle!.oraclePDA,
          oracleOperator: env.oracle!.operator,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc(),
      "InvalidProgramId"
    );
  });
});

describe("Token Close Instruction", () => {
  let env: TestEnvironment;
  let mintManager: MintManager;
  let playerManager: PlayerManager;
  let gameManager: GameManager;

  before(async () => {
    env = TestEnvironment.getInstance();
    if (!env.oracle) {
      await env.initialize();
    }
    mintManager = new MintManager(env.program, env.provider);
    playerManager = new PlayerManager(env.provider);
    gameManager = new GameManager(env.program);
  });

  const deriveCloseTokenAccounts = (
    mint: Awaited<ReturnType<MintManager["createMint"]>>
  ) => {
    const { gameToken, gameVault, gameTokenAccount } = computeGameTokenContext(
      env.program,
      mint.mint,
      mint.tokenProgram
    );

    return {
      tokenMint: mint.mint,
      gameToken,
      gameVault,
      gameTokenAccount,
      tokenProgram: mint.tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      oracle: env.oracle!.oraclePDA,
      oracleOperator: env.oracle!.operator,
    } as const;
  };

  it("should close token configuration and vault when empty", async () => {
    const mint = await mintManager.createMint();
    const accounts = deriveCloseTokenAccounts(mint);

    const event = await captureEvent(
      env.program,
      "tokenClosed",
      async () => {
        await env.program.methods
          .closeToken()
          .accountsStrict(accounts)
          .signers([env.oracle!.operatorKeypair])
          .rpc();
      }
    );

    expect(event.tokenMint).to.deep.equal(mint.mint);
    expect(event.operator).to.deep.equal(env.oracle!.operator);

    const gameTokenInfo = await env.provider.connection.getAccountInfo(
      accounts.gameToken
    );
    const vaultAccountInfo = await env.provider.connection.getAccountInfo(
      accounts.gameTokenAccount
    );

    expect(gameTokenInfo).to.be.null;
    expect(vaultAccountInfo).to.be.null;
  });

  it("should reject close_token when vault holds remaining balance", async () => {
    const mint = await mintManager.createMint();
    const accounts = deriveCloseTokenAccounts(mint);

    await mintManager.mintTokensToAccount(
      mint,
      accounts.gameTokenAccount,
      new anchor.BN(5_000)
    );

    try {
      await env.program.methods
        .closeToken()
        .accountsStrict(accounts)
        .signers([env.oracle!.operatorKeypair])
        .rpc();
      expect.fail("Expected close_token to reject when vault is not empty");
    } catch (error) {
      expect(errorToString(error)).to.include("TokenVaultNotEmpty");
    }
  });

  it("should reject close_token when fees remain outstanding", async () => {
    const mint = await mintManager.createMint();
    const accounts = deriveCloseTokenAccounts(mint);

    const [creator, opponent] = await playerManager.createPlayerPool(
      2,
      mint.mint
    );

    const ticketAmount = new anchor.BN(1_000_000);
    await playerManager.fundPlayer(creator, mint, ticketAmount.muln(2));
    await playerManager.fundPlayer(opponent, mint, ticketAmount.muln(2));

    const gameConfig = coinflipGameConfig({ amount: ticketAmount });

    const gameData = await gameManager.createGame(
      gameConfig,
      creator.player,
      mint.mint
    );

    await gameManager.joinGame(gameData.gamePDA, creator.player);
    await gameManager.joinGame(gameData.gamePDA, opponent.player);

    const gameAccount = await gameManager.fetchGame(gameData.gamePDA);
    const winnerIndex = calculateWinnerIndex(
      gameAccount.ticketsCount,
      gameData.secretKey,
      Number(gameAccount.lastSlot)
    );
    const winnerPlayer = getWinnerFromPlayers(
      [creator, opponent],
      winnerIndex
    );

  await gameManager.completeGame(
      gameData,
      winnerPlayer.player.publicKey,
      creator.player.publicKey,
      env.oracle!.operator,
      winnerIndex
    );

    const gameTokenAccount = await env.program.account.gameToken.fetch(
      accounts.gameToken
    );
    expect(gameTokenAccount.feeAmount.gt(new anchor.BN(0))).to.be.true;

    try {
      await env.program.methods
        .closeToken()
        .accountsStrict(accounts)
        .signers([env.oracle!.operatorKeypair])
        .rpc();
      expect.fail("Expected close_token to reject when fees are outstanding");
    } catch (error) {
      expect(errorToString(error)).to.include("TokenFeesOutstanding");
    }
  });
});
