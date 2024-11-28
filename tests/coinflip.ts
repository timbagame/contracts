import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { BN } from "@coral-xyz/anchor";
import { expect } from 'chai';

describe("coinflip", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as Program<Coinflip>;

  it("Initialize Config Successfully", async () => {
    // Generate a new keypair for treasury
    const treasury = anchor.web3.Keypair.generate().publicKey;
    // Set fee percentage (e.g., 1%)
    const feePercentage = new BN(1);
    // Use provider's wallet as operator
    const operator = program.provider.publicKey;
    // Create a new keypair for the config account
    const configAccount = anchor.web3.Keypair.generate();

    const tx = await program.methods
      .initializeConfig(treasury, feePercentage, operator)
      .accounts({
        config: configAccount.publicKey,
      })
      .signers([configAccount])
      .rpc();
    
    console.log("Your transaction signature", tx);

    // Fetch the created config account
    const configData = await program.account.config.fetch(configAccount.publicKey);

    // Verify the config was initialized with correct values
    expect(configData.treasury.toString()).to.equal(treasury.toString());
    expect(configData.feePercentage.toString()).to.equal(feePercentage.toString());
    expect(configData.operator.toString()).to.equal(operator.toString());
  });

  it("Initialize Game Successfully", async () => {
    // First initialize config
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

    // Now initialize game
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
    // Setup config first
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
      
      // If we reach here, the test should fail
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.toString()).to.include("InvalidParticipantCount");
    }
  });
});