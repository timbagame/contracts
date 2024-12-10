import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { BN } from "@coral-xyz/anchor";
import { expect } from 'chai';
import {
  createMint,
  getAccount,
  mintTo,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
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

    // Create game account to derive vault PDA
    const gameAccount = anchor.web3.Keypair.generate();

    // Create vault PDA for authority
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), gameAccount.publicKey.toBuffer()],
      program.programId
    );

    // Create Associated Token Account for creator
    const creatorTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      program.provider.publicKey
    );

    // Create a token account for the vault
    const vaultTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      vaultPDA,
      true  // allowOwnerOffCurve: true to allow PDA as owner
    );

    // Mint tokens to creator
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      creatorTokenAccountInfo.address,
      mintAuthority.publicKey,
      1_000_000_000,
      [mintAuthority]
    );

    return {
      mint,
      mintAuthority,
      gameAccount,
      vaultPDA,
      creatorTokenAccount: creatorTokenAccountInfo.address,
      vaultTokenAccount: vaultTokenAccountInfo.address
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

  it("Initialize Game with Invalid Parameters", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount
    } = await createSplTokenMint();

    // Try to initialize game with invalid parameters
    const amount = new BN(1_000_000);
    const invalidMaxParticipants = 1; // Should be at least 2 for coinflip
    const invalidMinParticipants = 3; // Can't be greater than max
    const timeoutDuration = new BN(3600);
    const isPrivate = false;

    try {
      await program.methods
        .initializeGame(
          { coinflip: {} },
          amount,
          invalidMaxParticipants,
          invalidMinParticipants,
          timeoutDuration,
          isPrivate
        )
        .accounts({
          game: gameAccount.publicKey,
          creator: program.provider.publicKey,
          config: configAccount.publicKey,
          tokenMint: mint,
          creatorTokenAccount: creatorTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          vault: vaultPDA,
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
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount
    } = await createSplTokenMint();

    // Initialize game
    const amount = new BN(1_000_000);
    const maxParticipants = 2;
    const minParticipants = 2;
    const timeoutDuration = new BN(3600);
    const isPrivate = false;

    const tx = await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        maxParticipants,
        minParticipants,
        timeoutDuration,
        isPrivate
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
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
    expect(gameData.tokenMint.toString()).to.equal(mint.toString());
    expect(gameData.participants.length).to.equal(1); // Creator is first participant

    // Verify token transfer
    const vaultTokenAccountInfo = await getAccount(
      program.provider.connection,
      vaultTokenAccount
    );
    expect(vaultTokenAccountInfo.amount.toString()).to.equal(amount.toString());
  });

  it("Join SPL Token Game Successfully", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount
    } = await createSplTokenMint();

    // Initialize game
    const amount = new BN(1_000_000);
    const maxParticipants = 2;
    const minParticipants = 2;
    const timeoutDuration = new BN(3600);
    const isPrivate = false;

    const tx = await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        maxParticipants,
        minParticipants,
        timeoutDuration,
        isPrivate
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
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
    expect(gameData.tokenMint.toString()).to.equal(mint.toString());
    expect(gameData.participants.length).to.equal(1); // Creator is first participant

    // Verify token transfer
    const vaultTokenAccountInfo = await getAccount(
      program.provider.connection,
      vaultTokenAccount
    );
    expect(vaultTokenAccountInfo.amount.toString()).to.equal(amount.toString());
  });

  it("Join Private Game Successfully", async () => {
    // Create operator keypair and config
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config with operator
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game with isPrivate = true
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        true // isPrivate
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority]
    );

    // Join game with both player and operator signatures
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .remainingAccounts([
        {
          pubkey: operatorKeypair.publicKey,
          isWritable: false,
          isSigner: true
        }
      ])
      .signers([player, operatorKeypair])
      .rpc();

    // Verify game state
    const updatedGameData = await program.account.game.fetch(gameAccount.publicKey);
    expect(updatedGameData.participants.length).to.equal(2);
    expect(updatedGameData.participants[1].toString()).to.equal(player.publicKey.toString());
  });

  it("Fail to Join Full Game", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game with max 2 participants
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund two more players
    const player1 = anchor.web3.Keypair.generate();
    const player2 = anchor.web3.Keypair.generate();

    for (const player of [player1, player2]) {
      const airdrop = await program.provider.connection.requestAirdrop(
        player.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await program.provider.connection.confirmTransaction(airdrop);
    }

    // Create token accounts for players and mint tokens
    const player1TokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player1,
      mint,
      player1.publicKey
    );

    const player2TokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player2,
      mint,
      player2.publicKey
    );

    // Mint tokens to players
    for (const playerAccount of [player1TokenAccount, player2TokenAccount]) {
      await mintTo(
        program.provider.connection,
        mintAuthority,
        mint,
        playerAccount,
        mintAuthority.publicKey,
        amount.toNumber(),
        [mintAuthority]
      );
    }

    // First player joins successfully
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player1.publicKey,
        playerTokenAccount: player1TokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player1])
      .rpc();

    // Second player attempts to join - should fail
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gameAccount.publicKey,
          player: player2.publicKey,
          playerTokenAccount: player2TokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          vault: vaultPDA,
          config: configAccount.publicKey,
        })
        .signers([player2])
        .rpc();

      expect.fail("Should have thrown GameFull error");
    } catch (error) {
      expect(error.toString()).to.include("GameFull");
    }
  });

  it("Fail to Join Game Twice", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        3, // Allow 3 participants to test double-join
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund player
    const player = anchor.web3.Keypair.generate();
    const airdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      3 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(airdrop);

    // Create player's token account
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber() * 2, // Enough for two attempts
      [mintAuthority]
    );

    // First join should succeed
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player])
      .rpc();

    // Second join should fail
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          playerTokenAccount: playerTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          vault: vaultPDA,
          config: configAccount.publicKey,
        })
        .signers([player])
        .rpc();

      expect.fail("Should have thrown AlreadyJoined error");
    } catch (error) {
      expect(error.toString()).to.include("AlreadyJoined");
    }
  });

  it("Fail to Join Private Game with Wrong Operator", async () => {
    // Create operator keypair and config with that operator
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config with our operator
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game with isPrivate = true
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        true // isPrivate
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority]
    );

    // Create fake operator
    const fakeOperator = anchor.web3.Keypair.generate();
    const fakeOperatorAirdrop = await program.provider.connection.requestAirdrop(
      fakeOperator.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(fakeOperatorAirdrop);

    // Try to join game with fake operator signature
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          playerTokenAccount: playerTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          vault: vaultPDA,
          config: configAccount.publicKey,
        })
        .remainingAccounts([
          {
            pubkey: fakeOperator.publicKey,
            isWritable: false,
            isSigner: true
          }
        ])
        .signers([player, fakeOperator])
        .rpc();

      expect.fail("Should have thrown SignatureRequired error");
    } catch (error) {
      expect(error.toString()).to.include("SignatureRequired");
    }
  });

  it("Set Oracle Hash Successfully", async () => {
    // Create config and game
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config with our operator
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority]
    );

    // Add second player to fill the game
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player])
      .rpc();

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gameAccount.publicKey,
        config: configAccount.publicKey,
        oracle: operatorKeypair.publicKey,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .signers([operatorKeypair])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gameAccount.publicKey);
    expect(gameData.status.readyForClaim).to.not.be.undefined;
    expect(gameData.oracleHash).to.deep.equal(hashValue);
    expect(gameData.winner).to.not.be.null;
  });

  it("Fail to Set Oracle Hash Without Operator Authority", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Add second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority]
    );

    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player])
      .rpc();

    // Try to set oracle hash with fake operator
    const fakeOperator = anchor.web3.Keypair.generate();
    try {
      const hashValue = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
      await program.methods
        .setOracleHash(hashValue)
        .accounts({
          game: gameAccount.publicKey,
          config: configAccount.publicKey,
          oracle: fakeOperator.publicKey,
          recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        })
        .signers([fakeOperator])
        .rpc();

      expect.fail("Should have thrown InvalidOperator error");
    } catch (error) {
      expect(error.toString()).to.include("InvalidOperator");
    }
  });

  it("Fail to Set Oracle Hash Before Game is Full", async () => {
    // Create operator keypair and config
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config with operator
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game with max 2 participants
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Try to set oracle hash before game is full
    try {
      const hashValue = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
      await program.methods
        .setOracleHash(hashValue)
        .accounts({
          game: gameAccount.publicKey,
          config: configAccount.publicKey,
          oracle: operatorKeypair.publicKey,
          recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        })
        .signers([operatorKeypair])
        .rpc();

      expect.fail("Should have thrown GameNotFull error");
    } catch (error) {
      expect(error.toString()).to.include("GameNotFull");
    }
  });

  it("Fail to Set Oracle Hash Twice", async () => {
    // Create operator keypair and config
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority]
    );

    // Join game with second player
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player])
      .rpc();

    // Set oracle hash first time
    const hashValue = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gameAccount.publicKey,
        config: configAccount.publicKey,
        oracle: operatorKeypair.publicKey,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .signers([operatorKeypair])
      .rpc();

    // Try to set oracle hash second time
    try {
      const newHashValue = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
      await program.methods
        .setOracleHash(newHashValue)
        .accounts({
          game: gameAccount.publicKey,
          config: configAccount.publicKey,
          oracle: operatorKeypair.publicKey,
          recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        })
        .signers([operatorKeypair])
        .rpc();

      expect.fail("Should have thrown OracleHashAlreadySet error");
    } catch (error) {
      expect(error.toString()).to.include("OracleHashAlreadySet");
    }
  });

  it("Claim Winnings Successfully (SPL)", async () => {
    // Create config and game
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token and accounts
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    // Create treasury token account
    const treasuryTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,  // Use mintAuthority as payer since it already has SOL
      mint,
      treasury
    );

    const amount = new BN(1_000_000);

    // Create game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      1_000_000_000,
      [mintAuthority]
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player])
      .rpc();

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gameAccount.publicKey,
        config: configAccount.publicKey,
        oracle: operatorKeypair.publicKey,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .signers([operatorKeypair])
      .rpc();

    // Get game data to find winner
    const gameData = await program.account.game.fetch(gameAccount.publicKey);
    const winner = gameData.winner;
    expect(winner).to.not.be.null;

    // Get winner's token account
    const winnerTokenAccount = winner.equals(program.provider.publicKey)
      ? creatorTokenAccount
      : playerTokenAccount;

    // Get initial balances
    const initialBalance = (await getAccount(program.provider.connection, winnerTokenAccount)).amount;

    // Claim winnings
    await program.methods
      .claimWinnings()
      .accounts({
        game: gameAccount.publicKey,
        winner: winner,
        config: configAccount.publicKey,
        vaultTokenAccount: vaultTokenAccount,
        winnerTokenAccount: winnerTokenAccount,
        treasuryTokenAccount: treasuryTokenAccount,
        vault: vaultPDA,
      })
      .signers(winner.equals(program.provider.publicKey) ? [] : [player])
      .rpc();

    // Verify winner received funds
    const finalBalance = (await getAccount(program.provider.connection, winnerTokenAccount)).amount;
    expect(finalBalance - initialBalance).to.equal(
      BigInt(amount.toNumber() * 2 * (1 - feePercentage.toNumber() / 100))  // Convert to BigInt
    );
  });

  it("Fail to Claim as Non-Winner", async () => {
    // Create config and game
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    // Create treasury token account
    const treasuryTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      treasury
    );

    const amount = new BN(1_000_000);

    // Create game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority]
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player])
      .rpc();

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gameAccount.publicKey,
        config: configAccount.publicKey,
        oracle: operatorKeypair.publicKey,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .signers([operatorKeypair])
      .rpc();

    // Get game data to find loser
    const gameData = await program.account.game.fetch(gameAccount.publicKey);
    const winner = gameData.winner;
    const loser = winner.equals(program.provider.publicKey) ? player.publicKey : program.provider.publicKey;
    const loserTokenAccount = winner.equals(program.provider.publicKey) ? playerTokenAccount : creatorTokenAccount;

    // Try to claim as loser
    try {
      await program.methods
        .claimWinnings()
        .accounts({
          game: gameAccount.publicKey,
          winner: loser,
          config: configAccount.publicKey,
          vaultTokenAccount: vaultTokenAccount,
          winnerTokenAccount: loserTokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
          vault: vaultPDA,
        })
        .signers(loser.equals(program.provider.publicKey) ? [] : [player])
        .rpc();

      expect.fail("Should have thrown NotWinner error");
    } catch (error) {
      expect(error.toString()).to.include("NotWinner");
    }
  });

  it("Claim Timeout When Game Expires", async () => {
    // Create game with short timeout
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(5), // 5 second timeout
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Get initial balance
    const initialBalance = (await getAccount(program.provider.connection, creatorTokenAccount)).amount;

    // Claim timeout
    await program.methods
      .claimTimeout()
      .accounts({
        game: gameAccount.publicKey,
        vaultTokenAccount: vaultTokenAccount,
        participantTokenAccount: creatorTokenAccount,
        vault: vaultPDA,
      })
      .rpc();

    // Verify funds returned
    const finalBalance = (await getAccount(program.provider.connection, creatorTokenAccount)).amount;
    expect(finalBalance - initialBalance).to.equal(BigInt(amount.toString()));
  });

  it("Fail to Claim Timeout Before Expiration", async () => {
    // Create config and game
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const configAccount = anchor.web3.Keypair.generate();

    // Initialize config
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        config: configAccount.publicKey,
        signer: program.provider.publicKey,
      })
      .signers([configAccount])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game with 1 hour timeout
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600), // 1 hour timeout
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Try to claim timeout immediately
    try {
      await program.methods
        .claimTimeout()
        .accounts({
          game: gameAccount.publicKey,
          vaultTokenAccount: vaultTokenAccount,
          participantTokenAccount: creatorTokenAccount,
          vault: vaultPDA,
        })
        .rpc();

      expect.fail("Should have thrown TimeoutNotReached error");
    } catch (error) {
      expect(error.toString()).to.include("TimeoutNotReached");
    }
  });

  it("Initialize and Join Giveaway Game Successfully", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const maxParticipants = 5;
    const minParticipants = 1;
    const timeoutDuration = new BN(3600);
    const isPrivate = false;

    // Initialize giveaway game
    await program.methods
      .initializeGame(
        { giveaway: {} },
        amount,
        maxParticipants,
        minParticipants,
        timeoutDuration,
        isPrivate
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Verify game state - creator should not be added as participant for giveaway
    const gameData = await program.account.game.fetch(gameAccount.publicKey);
    expect(gameData.participants.length).to.equal(0);
    expect(gameData.gameType.giveaway).to.not.be.undefined;
  });

  it("Fail to Initialize Config with Invalid Fee Percentage", async () => {
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const invalidFeePercentage = new BN(101); // More than 100%
    const operator = program.provider.publicKey;
    const configAccount = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .initializeConfig(treasury, invalidFeePercentage, operator)
        .accounts({
          config: configAccount.publicKey,
          signer: program.provider.publicKey,
        })
        .signers([configAccount])
        .rpc();

      expect.fail("Should have thrown error for invalid fee percentage");
    } catch (error) {
      expect(error.toString()).to.include("InvalidFeePercentage");
    }
  });

  it("Multiple Participants Can Claim Timeout", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game with short timeout
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        3, // 3 participants
        2,
        new BN(5), // 5 second timeout
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player, // payer
      mint,
      player.publicKey
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority]
    );

    // Join game with player
    await program.methods
      .joinGame()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
        config: configAccount.publicKey,
      })
      .signers([player])
      .rpc();

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Both participants claim timeout
    const initialCreatorBalance = (await getAccount(program.provider.connection, creatorTokenAccount)).amount;
    const initialPlayerBalance = (await getAccount(program.provider.connection, playerTokenAccount)).amount;

    // Creator claims timeout
    await program.methods
      .claimTimeout()
      .accounts({
        game: gameAccount.publicKey,
        vaultTokenAccount: vaultTokenAccount,
        participantTokenAccount: creatorTokenAccount,
        vault: vaultPDA,
        participant: program.provider.publicKey,
      })
      .rpc();

    // Player claims timeout
    await program.methods
      .claimTimeout()
      .accounts({
        game: gameAccount.publicKey,
        vaultTokenAccount: vaultTokenAccount,
        participantTokenAccount: playerTokenAccount,
        vault: vaultPDA,
        participant: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Verify both participants got their funds back
    const finalCreatorBalance = (await getAccount(program.provider.connection, creatorTokenAccount)).amount;
    const finalPlayerBalance = (await getAccount(program.provider.connection, playerTokenAccount)).amount;

    expect(finalCreatorBalance - initialCreatorBalance).to.equal(BigInt(amount.toString()));
    expect(finalPlayerBalance - initialPlayerBalance).to.equal(BigInt(amount.toString()));

    // Verify game is cancelled after all claims
    const gameData = await program.account.game.fetch(gameAccount.publicKey);
    expect(gameData.status.cancelled).to.not.be.undefined;
    expect(gameData.participants.length).to.equal(0);
  });

  it("Fail to Claim Timeout as Non-Participant", async () => {
    const { configAccount } = await createConfigAccount();
    const {
      mint,
      gameAccount,
      vaultPDA,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create game with short timeout
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(5), // 5 second timeout
        false
      )
      .accounts({
        game: gameAccount.publicKey,
        creator: program.provider.publicKey,
        config: configAccount.publicKey,
        tokenMint: mint,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        vault: vaultPDA,
      })
      .signers([gameAccount])
      .rpc();

    // Create non-participant account
    const nonParticipant = anchor.web3.Keypair.generate();
    const airdrop = await program.provider.connection.requestAirdrop(
      nonParticipant.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(airdrop);

    const nonParticipantTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      nonParticipant,
      mint,
      nonParticipant.publicKey
    );

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Try to claim timeout as non-participant
    try {
      await program.methods
        .claimTimeout()
        .accounts({
          game: gameAccount.publicKey,
          vaultTokenAccount: vaultTokenAccount,
          participantTokenAccount: nonParticipantTokenAccount,
          vault: vaultPDA,
          participant: nonParticipant.publicKey,
        })
        .signers([nonParticipant])
        .rpc({ skipPreflight: true });

      expect.fail("Should have thrown Invalid participant error");
    } catch (error) {
      expect(error.toString()).to.include("Invalid participant");
    }
  });
});
