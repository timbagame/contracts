import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { BN } from "@coral-xyz/anchor";
import { expect } from 'chai';
import {
  createMint,
  getAccount,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";

describe("coinflip", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as Program<Coinflip>;

  async function createConfigAccount() {
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const operator = program.provider.publicKey;
    const configAccount = anchor.web3.Keypair.generate();

    await program.methods
      .initializeConfig(treasury, feePercentage, operator)
      .accounts({
        config: configAccount.publicKey,
      })
      .signers([configAccount])
      .rpc();

    return { configAccount, treasury, feePercentage, operator };
  }

  async function createSplTokenMint() {
    const mintAuthority = anchor.web3.Keypair.generate();
    
    // Airdrop SOL to mintAuthority
    const signature = await program.provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(signature);

    const mint = await createMint(
      program.provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    // Create vault keypair and fund it
    const vault = anchor.web3.Keypair.generate();
    const vaultSignature = await program.provider.connection.requestAirdrop(
      vault.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(vaultSignature);

    // Create Associated Token Account for creator
    const creatorTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      program.provider.publicKey
    );

    // Create vault token account
    const vaultTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      vault.publicKey
    );

    // Mint tokens to creator
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      creatorTokenAccount,
      mintAuthority.publicKey,
      1_000_000_000,
      [mintAuthority]
    );

    return { 
      mint, 
      mintAuthority, 
      vault, 
      creatorTokenAccount, 
      vaultTokenAccount 
    };
  }

  it("Initialize Config Successfully", async () => {
    const { configAccount, treasury, feePercentage, operator } = await createConfigAccount();

    // Fetch the created config account
    const configData = await program.account.config.fetch(configAccount.publicKey);

    // Verify the config was initialized with correct values
    expect(configData.treasury.toString()).to.equal(treasury.toString());
    expect(configData.feePercentage.toString()).to.equal(feePercentage.toString());
    expect(configData.operator.toString()).to.equal(operator.toString());
  });

  it("Initialize Game Successfully", async () => {
    const { configAccount } = await createConfigAccount();

    // Initialize game
    const gameAccount = anchor.web3.Keypair.generate();
    const amount = new BN(1_000_000); // 1 SOL
    const maxParticipants = 2;
    const minParticipants = 2;
    const timeoutDuration = new BN(3600); // 1 hour
    const isPrivate = false;
    const isSol = true;

    const tx = await program.methods
      .initializeGame(
        { coinflip: {} }, // GameType
        amount,
        maxParticipants,
        minParticipants,
        timeoutDuration,
        isPrivate,
        isSol
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: null,
        creatorTokenAccount: null,
        vaultTokenAccount: null,
        vault: anchor.web3.Keypair.generate().publicKey,
      })
      .signers([gameAccount])
      .rpc();

    console.log("Game initialization signature", tx);

    // Fetch and verify game data
    const gameData = await program.account.game.fetch(gameAccount.publicKey);
    expect(gameData.creator.toString()).to.equal(program.provider.publicKey.toString());
    expect(gameData.amount.toString()).to.equal(amount.toString());
    expect(gameData.maxParticipants).to.equal(maxParticipants);
    expect(gameData.minParticipants).to.equal(minParticipants);
    expect(gameData.status.active).to.not.be.undefined;
    expect(gameData.isSol).to.be.true;
    expect(gameData.participants.length).to.equal(1); // Creator is first participant
  });

  it("Fail to Initialize Game with Invalid Parameters", async () => {
    const { configAccount } = await createConfigAccount();

    // Try to initialize game with invalid parameters
    const gameAccount = anchor.web3.Keypair.generate();
    const amount = new BN(1_000_000);
    const invalidMaxParticipants = 1; // Should be at least 2 for coinflip
    const invalidMinParticipants = 3; // Can't be greater than max
    const timeoutDuration = new BN(3600);
    const isPrivate = false;
    const isSol = true;

    try {
      await program.methods
        .initializeGame(
          { coinflip: {} },
          amount,
          invalidMaxParticipants,
          invalidMinParticipants,
          timeoutDuration,
          isPrivate,
          isSol
        )
        .accounts({
          game: gameAccount.publicKey,
          creator: program.provider.publicKey,
          config: configAccount.publicKey,
          tokenMint: null,
          creatorTokenAccount: null,
          vaultTokenAccount: null,
          vault: anchor.web3.Keypair.generate().publicKey,
        })
        .signers([gameAccount])
        .rpc();

      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.toString()).to.include("InvalidParticipantCount");
    }
  });

  it("Initialize Game with SPL Token Successfully", async () => {
    const { configAccount } = await createConfigAccount();
    const { 
      mint, 
      vault, 
      creatorTokenAccount, 
      vaultTokenAccount 
    } = await createSplTokenMint();

    // Initialize game
    const gameAccount = anchor.web3.Keypair.generate();
    const amount = new BN(1_000_000);
    const maxParticipants = 2;
    const minParticipants = 2;
    const timeoutDuration = new BN(3600);
    const isPrivate = false;
    const isSol = false;

    const tx = await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        maxParticipants,
        minParticipants,
        timeoutDuration,
        isPrivate,
        isSol
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vault.publicKey,
      })
      .signers([gameAccount])
      .rpc();

    console.log("Game initialization signature", tx);

    // Fetch and verify game data
    const gameData = await program.account.game.fetch(gameAccount.publicKey);
    expect(gameData.creator.toString()).to.equal(program.provider.publicKey.toString());
    expect(gameData.amount.toString()).to.equal(amount.toString());
    expect(gameData.maxParticipants).to.equal(maxParticipants);
    expect(gameData.minParticipants).to.equal(minParticipants);
    expect(gameData.status.active).to.not.be.undefined;
    expect(gameData.isSol).to.be.false;
    expect(gameData.tokenMint.toString()).to.equal(mint.toString());
    expect(gameData.participants.length).to.equal(1); // Creator is first participant

    // Verify token transfer
    const vaultTokenAccountInfo = await getAccount(
      program.provider.connection,
      vaultTokenAccount
    );
    expect(vaultTokenAccountInfo.amount.toString()).to.equal(amount.toString());
  });
});
