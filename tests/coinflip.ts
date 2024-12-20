import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  createMint,
  getAccount,
  mintTo,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

describe("coinflip", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as Program<Coinflip>;

  // Add this before all tests
  before(async () => {
    // Initialize config once for all tests
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);
    const operator = program.provider.publicKey;

    try {
      await program.methods
        .initializeConfig(treasury, feePercentage, operator)
        .accounts({
          signer: program.provider.publicKey,
        })
        .rpc();
    } catch (e) {
      // If config already exists, that's fine
      console.log("Config initialization failed, may already exist:", e);
    }
  });

  // Modify createConfigAccount to return just what we need
  async function createConfigAccount() {
    const [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    const configAccount = await program.account.config.fetch(configPDA);
    return {
      treasury: configAccount.treasury,
      feePercentage: configAccount.feePercentage,
      operator: configAccount.operator
    };
  }

  async function createSplTokenMint() {
    // Create keypair for mint authority
    const mintAuthority = anchor.web3.Keypair.generate();

    // Airdrop SOL to mintAuthority for rent
    const signature = await program.provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(signature);

    // Create the mint
    const mint = await createMint(
      program.provider.connection,
      mintAuthority,  // payer
      mintAuthority.publicKey,  // mint authority
      null,  // freeze authority
      6,  // decimals
    );

    // Create token account for creator (using provider's wallet)
    const creatorTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority, // payer
      mint,
      program.provider.publicKey,
    );

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const gamePDA = await getGamePDA(gameCounter);
    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), gamePDA.toBuffer()],
      program.programId
    );

    // Create token account for vault
    const vaultTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority, // payer
      mint,
      vaultPDA,
      true, // allowOwnerOffCurve
    );

    // Mint tokens to creator
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      creatorTokenAccountInfo.address,
      mintAuthority.publicKey,
      1_000_000_000,
      [mintAuthority],
    );

    return {
      mint,
      creatorTokenAccount: creatorTokenAccountInfo.address,
      vaultTokenAccount: vaultTokenAccountInfo.address,
      mintAuthority,
    };
  }

  // Add this helper function to get current game counter
  async function getCurrentGameCounter() {
    const [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const configAccount = await program.account.config.fetch(configPDA);
    return configAccount.gameCounter;
  }

  // Add this helper function at the top level
  async function getGamePDA(gameCounter: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.toArrayLike(Buffer, 'le', 8)],
      program.programId
    )[0];
  }

  it("Initialize Config Successfully", async () => {
    const { treasury, feePercentage, operator } = await createConfigAccount();

    // Get the config PDA
    const [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Fetch the created config account
    const configData = await program.account.config.fetch(configPDA);

    // Verify the config was initialized with correct values
    expect(configData.treasury.toString()).to.equal(treasury.toString());
    expect(configData.feePercentage.toString()).to.equal(feePercentage.toString());
    expect(configData.operator.toString()).to.equal(operator.toString());
  });

  it("Initialize Game with Invalid Parameters", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
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
          isPrivate,
        )
        .accounts({
          creator: program.provider.publicKey,
          creatorTokenAccount: creatorTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.toString()).to.include("InvalidParticipantCount");
    }
  });

  it("Initialize Game Successfully", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    // Initialize game
    const amount = new BN(1_000_000);
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2, // maxParticipants
        2, // minParticipants
        new BN(3600), // timeoutDuration
        false, // isPrivate
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player, // payer
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.participants[1].toString()).to.equal(player.publicKey.toString());
  });

  it("Join Game Successfully", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    // Initialize game
    const amount = new BN(1_000_000);
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2, // maxParticipants
        2, // minParticipants
        new BN(3600), // timeoutDuration
        false, // isPrivate
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player, // payer
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.participants[1].toString()).to.equal(player.publicKey.toString());
  });

  it("Join Private Game Successfully", async () => {
    // Get current config and operator
    const { operator } = await createConfigAccount();

    // Create SPL token setup
    const {
      mint,
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
        true, // isPrivate
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game with both player and operator signatures
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .remainingAccounts([
        {
          pubkey: operator,
          isWritable: false,
          isSigner: true,
        },
      ])
      .signers([player])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.participants[1].toString()).to.equal(player.publicKey.toString());
  });

  it("Fail to Join Full Game", async () => {
    await createConfigAccount();
    const {
      mint,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund two more players
    const player1 = anchor.web3.Keypair.generate();
    const player2 = anchor.web3.Keypair.generate();

    for (const player of [player1, player2]) {
      const airdrop = await program.provider.connection.requestAirdrop(
        player.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await program.provider.connection.confirmTransaction(airdrop);
    }

    // Create token accounts for players and mint tokens
    const player1TokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player1,
      mint,
      player1.publicKey,
    );

    const player2TokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player2,
      mint,
      player2.publicKey,
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
        [mintAuthority],
      );
    }

    // First player joins successfully
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
        playerTokenAccount: player1TokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player1])
      .rpc();

    // Second player attempts to join - should fail
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player2.publicKey,
          playerTokenAccount: player2TokenAccount,
          vaultTokenAccount: vaultTokenAccount,
        })
        .signers([player2])
        .rpc();

      expect.fail("Should have thrown GameFull error");
    } catch (error) {
      expect(error.toString()).to.include("GameFull");
    }
  });

  it("Fail to Join Game Twice", async () => {
    await createConfigAccount();
    const {
      mint,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund player
    const player = anchor.web3.Keypair.generate();
    const airdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      3 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(airdrop);

    // Create player's token account
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber() * 2, // Enough for two attempts
      [mintAuthority],
    );

    // First join should succeed
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Second join should fail
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
          playerTokenAccount: playerTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
        })
        .signers([player])
        .rpc();

      expect.fail("Should have thrown AlreadyJoined error");
    } catch (error) {
      expect(error.toString()).to.include("AlreadyJoined");
    }
  });

  it("Fail to Join Private Game with Wrong Operator", async () => {
    // Initialize config
    await createConfigAccount();

    // Create SPL token setup
    const {
      mint,
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
        true, // isPrivate
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Create fake operator
    const fakeOperator = anchor.web3.Keypair.generate();
    const fakeOperatorAirdrop = await program.provider.connection.requestAirdrop(
      fakeOperator.publicKey,
      anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(fakeOperatorAirdrop);

    // Try to join game with fake operator signature
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
          playerTokenAccount: playerTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
        })
        .remainingAccounts([
          {
            pubkey: fakeOperator.publicKey,
            isWritable: false,
            isSigner: true,
          },
        ])
        .signers([player, fakeOperator])
        .rpc();

      expect.fail("Should have thrown SignatureRequired error");
    } catch (error) {
      expect(error.toString()).to.include("SignatureRequired");
    }
  });

  it("Set Oracle Hash Successfully", async () => {
    // Get current config and operator
    const { operator } = await createConfigAccount();

    // Create SPL token setup
    const {
      mint,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Add second player to fill the game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        oracle: operator,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.status.readyForClaim).to.not.be.undefined;
    expect(gameData.oracleHash).to.deep.equal(hashValue);
    expect(gameData.winner).to.not.be.null;
  });

  it("Fail to Set Oracle Hash Without Operator Authority", async () => {
    await createConfigAccount();
    const {
      mint,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Add second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Try to set oracle hash with fake operator
    const fakeOperator = anchor.web3.Keypair.generate();
    try {
      const hashValue = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 256),
      );
      await program.methods
        .setOracleHash(hashValue)
        .accounts({
          game: gamePDA,
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
    // Get current config and operator
    const { operator } = await createConfigAccount();

    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Try to set oracle hash before game is full
    try {
      const hashValue = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 256),
      );
      await program.methods
        .setOracleHash(hashValue)
        .accounts({
          game: gamePDA,
          oracle: operator,
          recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        })
        .rpc();

      expect.fail("Should have thrown GameNotFull error");
    } catch (error) {
      expect(error.toString()).to.include("GameNotFull");
    }
  });

  it("Fail to Set Oracle Hash Twice", async () => {
    // Get current config and operator
    const { operator } = await createConfigAccount();

    const {
      mint,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Add second player to fill the game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Set oracle hash first time
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        oracle: operator,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .rpc();

    // Try to set oracle hash second time
    try {
      const newHashValue = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 256),
      );
      await program.methods
        .setOracleHash(newHashValue)
        .accounts({
          game: gamePDA,
          oracle: operator,
          recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        })
        .rpc();

      expect.fail("Should have thrown OracleHashAlreadySet error");
    } catch (error) {
      expect(error.toString()).to.include("OracleHashAlreadySet");
    }
  });

  it("Claim Winnings Successfully", async () => {
    // Get current config and operator
    const { operator, treasury, feePercentage } = await createConfigAccount();

    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    // Create treasury token account
    const treasuryTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      treasury,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        oracle: operator,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .rpc();

    // Get game data to find winner
    const gameData = await program.account.game.fetch(gamePDA);
    const winner = gameData.winner;
    expect(winner).to.not.be.null;

    // Get winner's token account
    const winnerTokenAccount = winner.equals(program.provider.publicKey)
      ? creatorTokenAccount
      : playerTokenAccount;

    // Get initial balances
    const initialBalance = (
      await getAccount(program.provider.connection, winnerTokenAccount)
    ).amount;

    // Claim winnings
    await program.methods
      .claimWinnings()
      .accounts({
        game: gamePDA,
        winner: winner,
        vaultTokenAccount: vaultTokenAccount,
        winnerTokenAccount: winnerTokenAccount,
        treasuryTokenAccount: treasuryTokenAccount,
      })
      .signers(winner.equals(program.provider.publicKey) ? [] : [player])
      .rpc();

    // Verify winner received funds
    const finalBalance = (
      await getAccount(program.provider.connection, winnerTokenAccount)
    ).amount;
    expect(finalBalance - initialBalance).to.equal(
      BigInt(amount.toNumber() * 2 * (1 - feePercentage.toNumber() / 100)),
    );
  });

  it("Fail to Claim as Non-Winner", async () => {
    // Get current config and operator
    const { operator, treasury } = await createConfigAccount();

    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    // Create treasury token account
    const treasuryTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      treasury,
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
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    // Create player's token account and mint tokens
    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        oracle: operator,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .rpc();

    // Try to claim as non-winner
    try {
      await program.methods
        .claimWinnings()
        .accounts({
          game: gamePDA,
          winner: player.publicKey,
          vaultTokenAccount: vaultTokenAccount,
          winnerTokenAccount: playerTokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
        })
        .signers([player])
        .rpc();

      expect.fail("Should have thrown NotWinner error");
    } catch (error) {
      expect(error.toString()).to.include("NotWinner");
    }
  });

  it("Claim Timeout When Game Expires", async () => {
    // Create game with short timeout
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();

    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(2), // 2 seconds timeout
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get game PDA
    const gamePDA = await getGamePDA(gameCounter);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Get initial balance
    const initialBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount)
    ).amount;

    // Claim timeout
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        vaultTokenAccount: vaultTokenAccount,
        participantTokenAccount: creatorTokenAccount,
        participant: program.provider.publicKey,
      })
      .rpc();

    // Verify funds returned
    const finalBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount)
    ).amount;
    expect(finalBalance - initialBalance).to.equal(BigInt(amount.toString()));
  });

  it("Initialize and Join Giveaway Game Successfully", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const maxParticipants = 5;
    const minParticipants = 1;
    const timeoutDuration = new BN(3600);
    const isPrivate = false;

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();

    // Initialize giveaway game
    await program.methods
      .initializeGame(
        { giveaway: {} },
        amount,
        maxParticipants,
        minParticipants,
        timeoutDuration,
        isPrivate,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get game PDA
    const gamePDA = await getGamePDA(gameCounter);

    // Verify game state - creator should not be added as participant for giveaway
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.participants.length).to.equal(0);
    expect(gameData.gameType.giveaway).to.not.be.undefined;
  });

  it("Fail to Initialize Config with Invalid Fee Percentage", async () => {
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const invalidFeePercentage = new BN(101); // More than 100%
    const operator = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .initializeConfig(treasury, invalidFeePercentage, operator.publicKey)
        .accounts({
          signer: program.provider.publicKey,
        })
        .signers([operator])
        .rpc();

      expect.fail("Should have thrown error for invalid fee percentage");
    } catch (error) {
      expect(error.toString()).to.include("InvalidFeePercentage");
    }
  });

  it("Multiple Participants Can Claim Timeout", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getCurrentGameCounter();

    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        3,
        2,
        new BN(4),
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    const gamePDA = await getGamePDA(gameCounter);

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Both participants claim timeout
    const initialCreatorBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount)
    ).amount;
    const initialPlayerBalance = (
      await getAccount(program.provider.connection, playerTokenAccount)
    ).amount;

    // Creator claims timeout
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        vaultTokenAccount: vaultTokenAccount,
        participantTokenAccount: creatorTokenAccount,
        participant: program.provider.publicKey,
      })
      .rpc();

    // Player claims timeout
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        vaultTokenAccount: vaultTokenAccount,
        participantTokenAccount: playerTokenAccount,
        participant: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Verify both participants got their funds back
    const finalCreatorBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount)
    ).amount;
    const finalPlayerBalance = (
      await getAccount(program.provider.connection, playerTokenAccount)
    ).amount;

    expect(finalCreatorBalance - initialCreatorBalance).to.equal(
      BigInt(amount.toString()),
    );
    expect(finalPlayerBalance - initialPlayerBalance).to.equal(
      BigInt(amount.toString()),
    );

    // Verify game is cancelled after all claims
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.status.cancelled).to.not.be.undefined;
    expect(gameData.participants.length).to.equal(0);
  });

  it("Fail to Claim Timeout as Non-Participant", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getCurrentGameCounter();

    // Create game with short timeout
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(2), // 2 seconds timeout
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    const gamePDA = await getGamePDA(gameCounter);

    // Create non-participant account
    const nonParticipant = anchor.web3.Keypair.generate();
    const airdrop = await program.provider.connection.requestAirdrop(
      nonParticipant.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(airdrop);

    const nonParticipantTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      nonParticipant,
      mint,
      nonParticipant.publicKey,
    );

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Try to claim timeout as non-participant
    try {
      await program.methods
        .unjoinGame()
        .accounts({
          game: gamePDA,
          vaultTokenAccount: vaultTokenAccount,
          participantTokenAccount: nonParticipantTokenAccount,
          participant: nonParticipant.publicKey,
        })
        .signers([nonParticipant])
        .rpc({ skipPreflight: true });

      expect.fail("Should have thrown Invalid participant error");
    } catch (error) {
      expect(error.toString()).to.include("Invalid participant");
    }
  });

  it("Set Oracle Hash When Minimum Participants Met and Timeout Passed", async () => {
    // Create config and game
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);

    // Initialize config
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        signer: program.provider.publicKey,
      })
      .signers([operatorKeypair])
      .rpc();

    // Create SPL token setup
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getCurrentGameCounter();

    // Create game with min participants = 2 and max participants = 10
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        10, // max participants
        2, // min participants
        new BN(7), // 7 seconds timeout
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    const gamePDA = await getGamePDA(gameCounter);

    // Create and fund players
    const players = [];
    for (let i = 0; i < 2; i++) {
      const player = anchor.web3.Keypair.generate();
      const playerAirdrop = await program.provider.connection.requestAirdrop(
        player.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await program.provider.connection.confirmTransaction(playerAirdrop);
      players.push(player);
    }

    // Create player's token accounts and mint tokens
    for (const player of players) {
      const playerTokenAccount = await createAssociatedTokenAccount(
        program.provider.connection,
        player,
        mint,
        player.publicKey,
      );

      await mintTo(
        program.provider.connection,
        mintAuthority,
        mint,
        playerTokenAccount,
        mintAuthority.publicKey,
        amount.toNumber(),
        [mintAuthority],
      );

      // Join game
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
          playerTokenAccount: playerTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
        })
        .signers([player])
        .rpc();
    }

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        oracle: operatorKeypair.publicKey,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .signers([operatorKeypair])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.status.readyForClaim).to.not.be.undefined;
    expect(gameData.oracleHash).to.deep.equal(hashValue);
    expect(gameData.winner).to.not.be.null;
  });

  it("Cannot Claim Winnings Multiple Times", async () => {
    // Create operator keypair and config
    const operatorKeypair = anchor.web3.Keypair.generate();
    const treasury = anchor.web3.Keypair.generate().publicKey;
    const feePercentage = new BN(1);

    // Initialize config with operator
    await program.methods
      .initializeConfig(treasury, feePercentage, operatorKeypair.publicKey)
      .accounts({
        signer: program.provider.publicKey,
      })
      .signers([operatorKeypair])
      .rpc();

    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    // Create and setup player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    // Create treasury token account
    await createAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      treasury,
    );

    const amount = new BN(1_000_000);
    const gameCounter = await getCurrentGameCounter();

    // Initialize game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    const gamePDA = await getGamePDA(gameCounter);

    // Mint tokens and join game
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Set oracle hash first time
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );

    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        oracle: operatorKeypair.publicKey,
        recentBlockhash: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      })
      .signers([operatorKeypair])
      .rpc();

    // Try to set oracle hash second time
    try {
      const newHashValue = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 256),
      );
      await program.methods
        .setOracleHash(newHashValue)
        .accounts({
          game: gamePDA,
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

  it("Cannot Join Game With Insufficient Funds", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Initialize game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getCurrentGameCounter();
    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.subn(1).toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create player with insufficient funds
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    // Mint insufficient tokens to player (half of required amount)
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber() / 2,
      [mintAuthority],
    );

    // Attempt to join game
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
          playerTokenAccount: playerTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
        })
        .signers([player])
        .rpc();

      expect.fail("Should not be able to join with insufficient funds");
    } catch (error) {
      expect(error.toString()).to.include("insufficient funds");
    }
  });

  it("Cannot Initialize Game with Negative or Zero Timeout", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Try with negative timeout
    try {
      await program.methods
        .initializeGame(
          { coinflip: {} },
          amount,
          2,
          2,
          new BN(-1), // Negative timeout
          false,
        )
        .accounts({
          creator: program.provider.publicKey,
          creatorTokenAccount: creatorTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should have thrown error for negative timeout");
    } catch (error) {
      expect(error.toString()).to.include("InvalidTimeout");
    }

    // Try with zero timeout
    try {
      await program.methods
        .initializeGame(
          { coinflip: {} },
          amount,
          2,
          2,
          new BN(0), // Zero timeout
          false,
        )
        .accounts({
          creator: program.provider.publicKey,
          creatorTokenAccount: creatorTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should have thrown error for zero timeout");
    } catch (error) {
      expect(error.toString()).to.include("InvalidTimeout");
    }
  });

  it("Cannot Initialize Game with Amount Overflow", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    // Try with max u64 value
    const maxAmount = new BN("18446744073709551615"); // 2^64 - 1

    try {
      await program.methods
        .initializeGame(
          { coinflip: {} },
          maxAmount,
          2,
          2,
          new BN(3600),
          false,
        )
        .accounts({
          creator: program.provider.publicKey,
          creatorTokenAccount: creatorTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should have thrown error for amount overflow");
    } catch (error) {
      // The error might be from token program or our validation
      expect(error.toString()).to.satisfy((msg: string) =>
        msg.includes("insufficient funds") || msg.includes("InvalidParticipantCount")
      );
    }

    // Try with amount that would overflow when calculating total pot
    const halfMaxAmount = new BN("9223372036854775808"); // 2^63

    try {
      await program.methods
        .initializeGame(
          { coinflip: {} },
          halfMaxAmount,
          3, // More than 2 participants to test multiplication overflow
          2,
          new BN(3600),
          false,
        )
        .accounts({
          creator: program.provider.publicKey,
          creatorTokenAccount: creatorTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should have thrown error for potential pot amount overflow");
    } catch (error) {
      expect(error.toString()).to.include("InvalidParticipantCount");
    }
  });

  it("Cannot Manipulate Game State Through Account Reinitialization", async () => {
    // First create and complete a game normally
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Initialize first game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    // Try to reinitialize the same game account
    try {
      await program.methods
        .initializeGame(
          { coinflip: {} },
          amount,
          2,
          2,
          new BN(3600),
          false,
        )
        .accounts({
          creator: program.provider.publicKey,
          creatorTokenAccount: creatorTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should not be able to reinitialize game account");
    } catch (error) {
      expect(error.toString()).to.include("already in use");
    }
  });

  it("Cannot Join Game With Different Token Mint", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getCurrentGameCounter();

    // Initialize game with first mint
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2,
        2,
        new BN(3600),
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    const gamePDA = await getGamePDA(gameCounter);

    // Create a different token mint
    const differentMintAuthority = anchor.web3.Keypair.generate();
    const differentMintAirdrop = await program.provider.connection.requestAirdrop(
      differentMintAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(differentMintAirdrop);

    const differentMint = await createMint(
      program.provider.connection,
      differentMintAuthority,
      differentMintAuthority.publicKey,
      null,
      6,
    );

    // Create player with different token mint
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      differentMint,
      player.publicKey,
    );

    // Mint tokens of different mint to player
    await mintTo(
      program.provider.connection,
      differentMintAuthority,
      differentMint,
      playerTokenAccount,
      differentMintAuthority.publicKey,
      amount.toNumber(),
      [differentMintAuthority],
    );

    // Try to join with different token mint
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
          playerTokenAccount: playerTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
        })
        .signers([player])
        .rpc();

      expect.fail("Should not be able to join with different token mint");
    } catch (error) {
      expect(error.toString()).to.include("InvalidToken");
    }
  });

  it("Can Cancel Bet Before Game is Full", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getCurrentGameCounter();

    // Initialize game with long timeout
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        3, // More than 2 to test cancellation before game is full
        2,
        new BN(4), // 4 seconds timeout
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    const gamePDA = await getGamePDA(gameCounter);

    // Get initial balance
    const initialBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount)
    ).amount;

    // Claim timeout (cancel bet) before game is full
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        vaultTokenAccount: vaultTokenAccount,
        participantTokenAccount: creatorTokenAccount,
        participant: program.provider.publicKey,
      })
      .rpc();

    // Verify funds were returned
    const finalBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount)
    ).amount;
    expect(finalBalance - initialBalance).to.equal(BigInt(amount.toString()));

    // Verify participant was removed
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.participants.length).to.equal(0);
  });

  it("Cannot Cancel Bet When Game is Full", async () => {
    await createConfigAccount();
    const {
      mint,
      creatorTokenAccount,
      vaultTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getCurrentGameCounter();

    // Initialize game
    await program.methods
      .initializeGame(
        { coinflip: {} },
        amount,
        2, // Only 2 participants needed
        2,
        new BN(3600),
        false,
      )
      .accounts({
        creator: program.provider.publicKey,
        creatorTokenAccount: creatorTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: mint,
      })
      .rpc();

    const gamePDA = await getGamePDA(gameCounter);

    // Create and fund second player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await createAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    // Mint tokens to player
    await mintTo(
      program.provider.connection,
      mintAuthority,
      mint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );

    // Join game with second player to make it full
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
        playerTokenAccount: playerTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
      })
      .signers([player])
      .rpc();

    // Try to cancel bet when game is full
    try {
      await program.methods
        .unjoinGame()
        .accounts({
          game: gamePDA,
          vaultTokenAccount: vaultTokenAccount,
          participantTokenAccount: creatorTokenAccount,
          participant: program.provider.publicKey,
        })
        .rpc();

      expect.fail("Should not be able to cancel when game is full");
    } catch (error) {
      expect(error.toString()).to.include("GameFull");
    }
  });
});
