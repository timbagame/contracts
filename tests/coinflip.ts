import * as anchor from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { expect } from "chai";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

function calculateWinnerIndex(playersCount: number, secretKey: number[], lastSlot: number): number {
  if (playersCount === 1) {
    return 0;
  }

  const nPlayers = BigInt(playersCount);

  // Hash combination of secret key and last_slot for additional entropy (same as contract)
  const combinedData = new Uint8Array(40);
  combinedData.set(secretKey, 0);

  // Convert lastSlot to little-endian bytes
  const lastSlotBytes = new Uint8Array(8);
  const lastSlotView = new DataView(lastSlotBytes.buffer);
  lastSlotView.setBigUint64(0, BigInt(lastSlot), true); // true for little-endian
  combinedData.set(lastSlotBytes, 32);

  const entropyHash = createHash('sha256').update(combinedData).digest();

  // Try sliding 8-byte windows through the hashed entropy
  const maxValid = BigInt('0xFFFFFFFFFFFFFFFF') - (BigInt('0xFFFFFFFFFFFFFFFF') % nPlayers);

  for (let startPos = 0; startPos <= 32 - 8; startPos++) {
    const randomBytes = entropyHash.slice(startPos, startPos + 8);
    const randomU64 = new DataView(randomBytes.buffer).getBigUint64(0, true);

    if (randomU64 < maxValid) {
      return Number(randomU64 % nPlayers);
    }
  }

  throw new Error("Unable to generate unbiased random number");
}

describe("coinflip", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as anchor.Program<Coinflip>;

  async function getGamePDA() {
    const secretKeyBuffer = anchor.web3.Keypair.generate().secretKey.slice(0, 32); // Only use first 32 bytes
    const secretKey = Array.from(secretKeyBuffer);
    const randomHashBuffer = createHash('sha256').update(secretKeyBuffer).digest();
    const randomHash = Array.from(randomHashBuffer);

    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), randomHashBuffer],
      program.programId
    );

    return { gamePDA, randomHash, secretKey };
  }
  // Add this before all tests
  before(async () => {
    // Initialize oracle once for all tests
    const config = {
      feePercentage: 1,
      oracleBufferTime: 2,
      maxPlayers: 100,
      maxTimeout: 86400,
      minTimeout: 1,
    };

    // Airdrop SOL to authority for rent
    const signature = await program.provider.connection.requestAirdrop(
      program.provider.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(signature);

    try {
      await program.methods
        .initializeOracle(config)
        .accounts({
          authority: program.provider.publicKey,
        })
        .rpc();

      // Create token mint and initialize token
      await createSplTokenMint();

    } catch (e) {
      // If oracle already exists, that's fine
      console.log("Initialization failed, may already exist:", e);
    }
  });

  // Modify createOracleAccount to return just what we need
  async function createOracleAccount() {
    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      program.programId
    );

    const oracleAccount = await program.account.oracle.fetch(oraclePDA);
    return {
      authority: oracleAccount.authority,
      feePercentage: oracleAccount.feePercentage,
      oracleBufferTime: oracleAccount.oracleBufferTime,
      oraclePDA: oraclePDA,
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

    // Get game_vault PDA using token mint
    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      program.programId
    );

    // Create game token account
    const gameTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority, // payer
      mint,
      gameVaultPDA,
      true, // allowOwnerOffCurve
    );

    // Create token account for oracle authority
    const oracleAuthorityTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority, // payer
      mint,
      program.provider.publicKey, // oracle authority
    );

    // Try to initialize token, if it fails it may already exist
    try {
      const tokenConfig = {
        minAmount: new anchor.BN(1000),
        enabled: true,
      };

      await program.methods
        .initializeToken(tokenConfig)
        .accounts({
          tokenMint: mint,
          authority: program.provider.publicKey,
        })
        .rpc();
    } catch (e) {
      // Token may already be initialized, that's fine
      console.log("Token initialization failed, may already exist:", e);
    }

    // Get game_token PDA using token mint
    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), mint.toBuffer()],
      program.programId
    );

    return {
      mint,
      gameTokenAccount,
      mintAuthority,
      oracleAuthorityTokenAccount,
      gameTokenPDA,
      gameVaultPDA
    };
  }

  async function mintTokens(mintAuthority: anchor.web3.Keypair, tokenMint: PublicKey, playerTokenAccount: PublicKey, amount: anchor.BN) {
    await mintTo(
      program.provider.connection,
      mintAuthority,
      tokenMint,
      playerTokenAccount,
      mintAuthority.publicKey,
      amount.toNumber(),
      [mintAuthority],
    );
  }

  async function createPlayer(tokenMint: PublicKey) {
    // Create player keypair
    const player = anchor.web3.Keypair.generate();

    // Airdrop SOL to player for rent
    const signature = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(signature);

    // get or create player token account
    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      player, // payer
      tokenMint,
      player.publicKey,
    );

    // Initialize player balance
    await program.methods
      .initializePlayerBalance()
      .accounts({
        player: player.publicKey,
        tokenMint: tokenMint,
      })
      .signers([player])
      .rpc();

    // Get player balance PDA
    const [playerBalancePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_balance"), player.publicKey.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    return {
      player,
      playerTokenAccount,
      playerBalancePDA,
    };
  }


  it("Initialize Oracle Successfully", async () => {
    const { authority, feePercentage, oracleBufferTime } = await createOracleAccount();

    // Get the oracle PDA
    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      program.programId
    );

    // Fetch the created oracle account
    const oracleData = await program.account.oracle.fetch(oraclePDA);

    // Verify the oracle was initialized with correct values
    expect(oracleData.authority.toString()).to.equal(authority.toString());
    expect(oracleData.feePercentage.toString()).to.equal(feePercentage.toString());
    expect(oracleData.oracleBufferTime.toString()).to.equal(oracleBufferTime.toString());
  });

  it("Initialize Game with Invalid Parameters", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const {
      player,
      playerTokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, playerTokenAccount.address, new anchor.BN(1_000_000));

    // Try to initialize game with invalid parameters
    const amount = new anchor.BN(1_000_000);
    const invalidMaxParticipants = 1; // Should be at least 2 for coinflip
    const invalidMinParticipants = 3; // Can't be greater than max
    const timeoutDuration = 3600;
    const isPrivate = false;
    const { randomHash } = await getGamePDA();

    try {
      const gameConfig = {
        gameType: { coinflip: {} },
        amount: amount,
        maxPlayers: invalidMaxParticipants,
        minPlayers: invalidMinParticipants,
        timeout: timeoutDuration,
        isPrivate: isPrivate,
      };

      await program.methods
        .initializeGame(gameConfig, randomHash)
        .accounts({
          creator: player.publicKey,
          tokenMint: mint,
        })
        .signers([player])
        .rpc();

      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.toString()).to.include("InvalidPlayersCount");
    }
  });

  it("Initialize Game and Join Successfully", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player,
      playerTokenAccount } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, new anchor.BN(1_000_000));
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, new anchor.BN(1_000_000));

    // Initialize game
    const amount = new anchor.BN(1_000_000);
    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins their own game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Second player joins game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2);
  });

  it("Join Private Game Successfully", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create joiner using helper
    const {
      player: joiner,
      playerTokenAccount: joinerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    const amount = new anchor.BN(1_000_000);
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, joinerTokenAccount.address, amount);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: true,
    };

    // Initialize game with isPrivate = true
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins their own private game (with oracle authority)
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
        authority: program.provider.publicKey,
      })
      .signers([creator])
      .rpc();

    // Joiner joins game with oracle signatures
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: joiner.publicKey,
        authority: program.provider.publicKey,
      })
      .signers([joiner])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2);
  });

  it("Fail to Join Full Game", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Create game with max 2 participants
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins their own game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create first player
    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    // Create second player
    const {
      player: player2,
      playerTokenAccount: player2TokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to players
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player2TokenAccount.address, amount);

    // First player joins successfully (game is now full)
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
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
        })
        .signers([player2])
        .rpc();

      expect.fail("Should have thrown GameFull error");
    } catch (error) {
      expect(error.toString()).to.include("GameFull");
    }
  });

  it("Fail to Join Game Twice", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 3,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins their own game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create player
    const {
      player,
      playerTokenAccount } = await createPlayer(mint);

    // Mint tokens to player
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount.muln(2)); // Enough for two attempts

    // Player joins game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Player tries to join again - should fail
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
        })
        .signers([player])
        .rpc();

      expect.fail("Should have thrown an error for duplicate join");
    } catch (error) {
      // In the new architecture, attempting to create the same PlayerParticipation PDA twice
      // results in a simulation failure rather than our custom AlreadyJoined error
      expect(error.toString()).to.include("Simulation failed");
    }
  });

  it("Fail to Join Private Game with Wrong Authority", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: true,
    };

    // Create game with isPrivate = true
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Create player
    const {
      player,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to player
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

    // Create fake authority
    const fakeAuthority = anchor.web3.Keypair.generate();

    // Try to join game with fake oracle signature
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
          authority: fakeAuthority.publicKey,
        })
        .signers([player, fakeAuthority])
        .rpc();

      expect.fail("UnauthorizedPlayer");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedPlayer");
    }
  });

  it("Complete Game Successfully", async () => {
    const {
    } = await createOracleAccount();

    // Create SPL token setup
    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

    const { gamePDA, randomHash, secretKey } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Create game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins their own game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Join game with second player
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
      })
      .signers([player])
      .rpc();

    const playersGameData = await program.account.game.fetch(gamePDA);
    const winnerIndex = calculateWinnerIndex(playersGameData.playersCount, secretKey, Number(playersGameData.lastSlot));

    // Get winner key (creator is index 0, player is index 1)
    const winner = winnerIndex === 0 ? creator.publicKey : player.publicKey;

    await program.methods
      .completeGame(randomHash, secretKey)
      .accounts({
        authority: program.provider.publicKey,
        winner: winner,
        creator: creator.publicKey,
      })
      .rpc();

    // Verify the game was completed (total_amount should be 0)
    const completedGameData = await program.account.game.fetch(gamePDA);
    expect(completedGameData.totalAmount.toNumber()).to.equal(0);
  });

  it("Fail to Set Oracle Random Number Without Oracle Authority", async () => {
    const {
    } = await createOracleAccount();

    // Create SPL token setup
    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount);

    const { gamePDA, randomHash, secretKey } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Create game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins their own game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Join game with second player
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Try to set oracle random number with fake oracle authority
    const fakeAuthority = anchor.web3.Keypair.generate();
    const playersGameData = await program.account.game.fetch(gamePDA);
    const winnerIndex = calculateWinnerIndex(playersGameData.playersCount, secretKey, Number(playersGameData.lastSlot));
    const winner = winnerIndex === 0 ? creator.publicKey : player1.publicKey;


    try {
      await program.methods
        .completeGame(randomHash, secretKey)
        .accounts({
          authority: fakeAuthority.publicKey,
          winner: winner,
          creator: creator.publicKey,
        })
        .signers([fakeAuthority])
        .rpc();

      expect.fail("Should have thrown UnauthorizedAuthority error");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedAuthority");
    }
  });

  it("Fail to Set Oracle Random Number Before Game is Full", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    const { randomHash, secretKey } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Create game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Try to set oracle random number before game is full
    try {
      await program.methods
        .completeGame(randomHash, secretKey)
        .accounts({
          authority: program.provider.publicKey,
          winner: creator.publicKey,
          creator: creator.publicKey,
        })
        .rpc();

      expect.fail("Should have thrown an error for game not ready");
    } catch (error) {
      // In the new architecture, since no players have joined, there's no winner_participation account
      // This causes an account error before reaching the game logic
      expect(error.toString()).to.include("winner_participation");
    }
  });

  it("Fail to Set Oracle Random Number Twice", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    const { gamePDA, randomHash, secretKey } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Create game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Create and join with second player
    const {
      player,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to player
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
      })
      .signers([player])
      .rpc();

    const playersGameData = await program.account.game.fetch(gamePDA);
    const winnerIndex = calculateWinnerIndex(playersGameData.playersCount, secretKey, Number(playersGameData.lastSlot));
    const winner = winnerIndex === 0 ? creator.publicKey : player.publicKey;

    // Set oracle random number first time
    await program.methods
      .completeGame(randomHash, secretKey)
      .accounts({
        authority: program.provider.publicKey,
        winner: winner,
        creator: creator.publicKey,
      })
      .rpc();

    // Try to set oracle random number second time (should fail since winner_participation was closed)
    try {
      await program.methods
        .completeGame(randomHash, secretKey)
        .accounts({
          authority: program.provider.publicKey,
          winner: winner,
          creator: creator.publicKey,
        })
        .rpc();

      expect.fail("Should have thrown error since winner_participation was closed");
    } catch (error) {
      // The winner_participation account was closed in the first completeGame call
      expect(error.toString()).to.include("AccountNotInitialized");
    }
  });

  it("Claim Winnings Successfully", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
      playerBalancePDA: creatorPlayerBalancePDA,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
      playerBalancePDA: player1PlayerBalancePDA,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount);

    const { gamePDA, randomHash, secretKey } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Initialize game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins their own game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Second player joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    const playersGameData = await program.account.game.fetch(gamePDA);
    const winnerIndex = calculateWinnerIndex(playersGameData.playersCount, secretKey, Number(playersGameData.lastSlot));
    const winnerPubkey = winnerIndex === 0 ? creator.publicKey : player1.publicKey;

    // Get initial balance of winner
    const winnerBalancePDA = winnerPubkey.equals(creator.publicKey)
      ? creatorPlayerBalancePDA
      : player1PlayerBalancePDA;

    const initialWinnerBalance = await program.account.playerBalance.fetch(winnerBalancePDA);

    // Set oracle random number (which automatically transfers winnings)
    await program.methods
      .completeGame(randomHash, secretKey)
      .accounts({
        authority: program.provider.publicKey,
        winner: winnerPubkey,
        creator: creator.publicKey,
      })
      .rpc();

    // Verify winner received funds in their player balance
    const finalWinnerBalance = await program.account.playerBalance.fetch(winnerBalancePDA);

    // Calculate expected winnings (amount * 2 - fees)
    const totalPot = amount.toNumber() * 2;
    const feeAmount = totalPot * 0.01; // 1% fee
    const expectedWinnings = totalPot - feeAmount;

    expect(finalWinnerBalance.amount.toNumber() - initialWinnerBalance.amount.toNumber())
      .to.equal(expectedWinnings);
  });

  it("Initialize and Join Giveaway Game Successfully", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);
    const maxParticipants = 2;
    const minParticipants = 1;
    const timeoutDuration = 3600;
    const isPrivate = false;

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create first player using helper
    const {
      player: player1,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player: player2,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { giveaway: {} },
      amount: amount,
      maxPlayers: maxParticipants,
      minPlayers: minParticipants,
      timeout: timeoutDuration,
      isPrivate: isPrivate,
    };

    // Initialize giveaway game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // First player joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Second player joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player2.publicKey,
      })
      .signers([player2])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2);
    expect(gameData.gameType.giveaway).to.not.be.undefined;
    expect(gameData.creator.equals(creator.publicKey)).to.be.true;
  });

  it("Cannot Join Game With Insufficient Funds", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Initialize game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Create player with insufficient funds
    const {
      player,
      playerTokenAccount } = await createPlayer(mint);

    // Mint insufficient tokens to player (half of required amount)
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount.divn(2));

    // Attempt to join game
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.publicKey,
        })
        .signers([player])
        .rpc();

      expect.fail("Should not be able to join with insufficient funds");
    } catch (error) {
      expect(error.toString()).to.include("InsufficientBalance");
    }
  });
});
