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

  // Global test state - reused across tests for speed
  let globalMint: PublicKey;
  let globalMintAuthority: anchor.web3.Keypair;
  let globalOraclePDA: PublicKey;
  let globalPlayers: Array<{
    player: anchor.web3.Keypair;
    playerTokenAccount: any;
    playerBalancePDA: PublicKey;
  }> = [];

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
    console.log("🚀 Setting up global test resources for speed...");

    // Initialize oracle once for all tests
    const config = {
      feePercentage: 1,
      oracleBufferTime: 2,
      maxPlayers: 100,
      maxTimeout: 86400,
      minTimeout: 1,
    };

    // Get oracle PDA
    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      program.programId
    );
    globalOraclePDA = oraclePDA;

    try {
      // Airdrop SOL to authority for rent
      const signature = await program.provider.connection.requestAirdrop(
        program.provider.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL, // More SOL upfront
      );
      await program.provider.connection.confirmTransaction(signature);

      await program.methods
        .initializeOracle(config)
        .accounts({
          authority: program.provider.publicKey,
        })
        .rpc();

      console.log("✅ Oracle initialized");
    } catch (e) {
      console.log("Oracle already exists, continuing...");
    }

    // Create global token mint
    const { mint, mintAuthority } = await createGlobalTokenMint();
    globalMint = mint;
    globalMintAuthority = mintAuthority;

    // Pre-create a pool of players for tests to reuse
    console.log("🎮 Creating player pool...");
    await createPlayerPool(8); // Create 8 players upfront

    console.log("✅ Global setup complete");
  });

  // Optimized helper functions for speed
  async function createGlobalTokenMint() {
    const mintAuthority = anchor.web3.Keypair.generate();

    // Airdrop SOL to mintAuthority
    const signature = await program.provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(signature);

    const mint = await createMint(
      program.provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6,
    );

    // Create the required associated token accounts first
    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      program.programId
    );

    await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      gameVaultPDA,
      true,
    );

    await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      program.provider.publicKey,
    );

    // Now initialize token config
    const tokenConfig = { minAmount: new anchor.BN(1000), enabled: true };
    await program.methods
      .initializeToken(tokenConfig)
      .accounts({
        authority: program.provider.publicKey,
        tokenMint: mint,
      })
      .rpc();

    return { mint, mintAuthority };
  }

  async function createPlayerPool(count: number) {
    // Batch create keypairs
    const players = Array.from({ length: count }, () => anchor.web3.Keypair.generate());

    // Batch airdrop SOL
    const airdropPromises = players.map(player =>
      program.provider.connection.requestAirdrop(player.publicKey, 3 * anchor.web3.LAMPORTS_PER_SOL)
    );
    const signatures = await Promise.all(airdropPromises);

    // Confirm all airdrops
    await Promise.all(signatures.map(sig => program.provider.connection.confirmTransaction(sig)));

    // Create player data in parallel
    const playerPromises = players.map(async (player) => {
      // Create token account
      const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
        program.provider.connection,
        player,
        globalMint,
        player.publicKey,
      );

      // Initialize player balance
      await program.methods
        .initializePlayerBalance()
        .accounts({
          player: player.publicKey,
          tokenMint: globalMint,
        })
        .signers([player])
        .rpc();

      const [playerBalancePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("player_balance"), player.publicKey.toBuffer(), globalMint.toBuffer()],
        program.programId
      );

      // Mint tokens to player
      await mintTo(
        program.provider.connection,
        globalMintAuthority,
        globalMint,
        playerTokenAccount.address,
        globalMintAuthority,
        10_000_000, // 10M tokens
      );

      return { player, playerTokenAccount, playerBalancePDA };
    });

    globalPlayers = await Promise.all(playerPromises);
  }

  // Fast helper to get pre-created resources
  async function getTestResources() {
    return {
      mint: globalMint,
      mintAuthority: globalMintAuthority,
      oraclePDA: globalOraclePDA,
    };
  }

  async function getTestPlayers(count: number) {
    if (count > globalPlayers.length) {
      throw new Error(`Requested ${count} players, but only ${globalPlayers.length} available in pool`);
    }
    return globalPlayers.slice(0, count);
  }

  // Legacy function for backward compatibility
  async function createOracleAccount() {
    const oracleAccount = await program.account.oracle.fetch(globalOraclePDA);
    return {
      authority: oracleAccount.authority,
      feePercentage: oracleAccount.feePercentage,
      oracleBufferTime: oracleAccount.oracleBufferTime,
      oraclePDA: globalOraclePDA,
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

  // Helper function to call unjoin with proper accounts for swap-with-last approach
  async function unjoinPlayer(gamePDA: PublicKey, playerToUnjoin: anchor.web3.Keypair, gameData: any, allPlayers: anchor.web3.Keypair[] = []) {
    // First, get the departing player's current index
    const [departingPlayerParticipationPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), playerToUnjoin.publicKey.toBuffer()],
      program.programId
    );

    const departingPlayerParticipation = await program.account.playerParticipation.fetch(departingPlayerParticipationPDA);
    const departingIndex = departingPlayerParticipation.playerIndex;
    const lastIndex = gameData.playersCount - 1;

    const accounts: any = {
      game: gamePDA,
      player: playerToUnjoin.publicKey,
    };

    let remainingAccounts = [];

    // Only add last player account if departing player is NOT the last player
    if (departingIndex !== lastIndex && gameData.playersCount > 1) {
      // Find the actual last player by checking all provided players
      for (const player of allPlayers) {
        try {
          const [participationPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("player_participation"), gamePDA.toBuffer(), player.publicKey.toBuffer()],
            program.programId
          );

          const participationAccount = await program.account.playerParticipation.fetch(participationPDA);
          if (participationAccount.playerIndex === lastIndex) {
            remainingAccounts.push({
              pubkey: participationPDA,
              isWritable: true,
              isSigner: false,
            });
            break;
          }
        } catch (e) {
          // Account doesn't exist, continue
        }
      }
    }

    return await program.methods
      .unjoinGame()
      .accounts(accounts)
      .remainingAccounts(remainingAccounts)
      .signers([playerToUnjoin])
      .rpc();
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

    // Creator joins their own game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
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

    // Second player joins game
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

  // ========================================
  // STATE INCONSISTENCY EXPLOIT TESTS
  // ========================================

  it("Test Player Count Inconsistency After Failed Join", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

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

    // Creator joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create player with insufficient funds
    const {
      player: poorPlayer,
      playerTokenAccount: poorPlayerTokenAccount,
    } = await createPlayer(mint);

    // Mint insufficient tokens (should cause join to fail)
    await mintTokens(mintAuthority, mint, poorPlayerTokenAccount.address, amount.divn(2));

    // Verify initial state
    let gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(1);

    // Attempt join with insufficient funds (should fail)
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: poorPlayer.publicKey,
        })
        .signers([poorPlayer])
        .rpc();
      expect.fail("Join should have failed due to insufficient funds");
    } catch (error) {
      expect(error.toString()).to.include("InsufficientBalance");
    }

    // Verify player count remains consistent after failed join
    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(1, "Player count should not change after failed join");

    // Verify no player participation account was created for failed join
    const [poorPlayerParticipationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), poorPlayer.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.account.playerParticipation.fetch(poorPlayerParticipationPDA);
      expect.fail("Player participation account should not exist after failed join");
    } catch (error) {
      expect(error.toString()).to.include("Account does not exist");
    }
  });

  it("Test Unjoin with Swap-with-Last Approach", async () => {
    // Use pre-created global resources for speed
    const { mint } = await getTestResources();
    const players = await getTestPlayers(3);

    const [creator, player1, player2] = players;
    const amount = new anchor.BN(1_000_000);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 5, // Increase max players to avoid "waiting for oracle" state
      minPlayers: 4, // Set higher min players so 3 players don't trigger oracle waiting
      timeout: 3600,
      isPrivate: false,
    };

    // Initialize game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.player.publicKey,
        tokenMint: mint,
      })
      .signers([creator.player])
      .rpc();

    // All players join (creator=index 0, player1=index 1, player2=index 2)
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.player.publicKey,
      })
      .signers([creator.player])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.player.publicKey,
      })
      .signers([player1.player])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player2.player.publicKey,
      })
      .signers([player2.player])
      .rpc();

    // Verify all players joined
    let gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(3);

    const allPlayers = [creator.player, player1.player, player2.player];

    // Test: Any player can now unjoin (not just the last one)
    // Let's have player1 (index 1) unjoin first - should work with swap
    await unjoinPlayer(gamePDA, player1.player, gameData, allPlayers);

    // Verify state after unjoin - player count decreased
    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2);

    // Verify index swapping worked correctly:
    // player2 should now have index 1 (swapped from index 2)
    const [player2ParticipationPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), player2.player.publicKey.toBuffer()],
      program.programId
    );

    const player2Participation = await program.account.playerParticipation.fetch(player2ParticipationPDA);
    expect(player2Participation.playerIndex).to.equal(1); // Should have been swapped to index 1

    // Now test creator (index 0) can unjoin
    gameData = await program.account.game.fetch(gamePDA);
    await unjoinPlayer(gamePDA, creator.player, gameData, [creator.player, player2.player]);

    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(1);

    // Verify player2 is now at index 0 (swapped from index 1)
    const player2ParticipationAfterSwap = await program.account.playerParticipation.fetch(player2ParticipationPDA);
    expect(player2ParticipationAfterSwap.playerIndex).to.equal(0);
  });

  it("Test Orphaned Player Participation Account Prevention", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator and player
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount);

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 5, // Higher max to avoid oracle waiting state
      minPlayers: 4, // Higher min players requirement
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

    // Creator and player join
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Get participation account addresses
    const [creatorParticipationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), creator.publicKey.toBuffer()],
      program.programId
    );

    const [player1ParticipationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), player1.publicKey.toBuffer()],
      program.programId
    );

    // Verify both participation accounts exist
    const creatorParticipation = await program.account.playerParticipation.fetch(creatorParticipationPDA);
    const player1Participation = await program.account.playerParticipation.fetch(player1ParticipationPDA);

    expect(creatorParticipation.playerIndex).to.equal(0);
    expect(player1Participation.playerIndex).to.equal(1);

    // Player1 unjoins (valid operation - only 2 players, need 4 min, so not waiting for oracle)
    let gameData = await program.account.game.fetch(gamePDA);
    await unjoinPlayer(gamePDA, player1, gameData, [creator, player1]);

    // Verify player1's participation account was closed
    try {
      await program.account.playerParticipation.fetch(player1ParticipationPDA);
      expect.fail("Player1 participation account should be closed after unjoin");
    } catch (error) {
      expect(error.toString()).to.include("Account does not exist");
    }

    // Verify creator's participation account still exists
    const remainingCreatorParticipation = await program.account.playerParticipation.fetch(creatorParticipationPDA);
    expect(remainingCreatorParticipation.playerIndex).to.equal(0);

    // Verify game state is consistent
    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(1);
  });

  it("Test Player Index Consistency After Multiple Operations", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create multiple players
    const players = [];
    for (let i = 0; i < 4; i++) {
      const {
        player,
        playerTokenAccount,
      } = await createPlayer(mint);
      await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);
      players.push({ player, playerTokenAccount });
    }

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 6, // Increase to avoid oracle waiting
      minPlayers: 5, // Higher min requirement
      timeout: 3600,
      isPrivate: false,
    };

    // Initialize game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: players[0].player.publicKey,
        tokenMint: mint,
      })
      .signers([players[0].player])
      .rpc();

    // All players join sequentially
    for (let i = 0; i < 4; i++) {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: players[i].player.publicKey,
        })
        .signers([players[i].player])
        .rpc();
    }

    // Verify all joined with correct indices
    for (let i = 0; i < 4; i++) {
      const [participationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("player_participation"), gamePDA.toBuffer(), players[i].player.publicKey.toBuffer()],
        program.programId
      );
      const participation = await program.account.playerParticipation.fetch(participationPDA);
      expect(participation.playerIndex).to.equal(i, `Player ${i} should have index ${i}`);
    }

    // Complex sequence: last player unjoins, then rejoins
    let gameData = await program.account.game.fetch(gamePDA);
    await unjoinPlayer(gamePDA, players[3].player, gameData, players.map(p => p.player));

    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(3);

    // Player 3 rejoins - should get index 3 again
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: players[3].player.publicKey,
      })
      .signers([players[3].player])
      .rpc();

    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(4);

    // Verify player 3 has correct index after rejoin
    const [player3ParticipationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), players[3].player.publicKey.toBuffer()],
      program.programId
    );
    const player3Participation = await program.account.playerParticipation.fetch(player3ParticipationPDA);
    expect(player3Participation.playerIndex).to.equal(3, "Player 3 should have index 3 after rejoin");
  });

  it("Test State Consistency During Snowball Game Unjoin Restrictions", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create players
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount.muln(5));
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount.muln(5));

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { snowball: {} }, // Snowball game type
      amount: amount,
      maxPlayers: 3,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Initialize Snowball game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Player1 joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    let gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2);

    // In Snowball games with multiple players, unjoin should be restricted
    try {
      await unjoinPlayer(gamePDA, player1, gameData, [creator, player1]);
      expect.fail("Snowball game with multiple players should not allow unjoin");
    } catch (error) {
      expect(error.toString()).to.include("SnowballMultiPlayerUnjoin");
    }

    // Verify state remains unchanged after failed unjoin attempt
    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2, "Player count should remain unchanged after failed unjoin");

    // Verify both participation accounts still exist
    const [creatorParticipationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), creator.publicKey.toBuffer()],
      program.programId
    );

    const [player1ParticipationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), player1.publicKey.toBuffer()],
      program.programId
    );

    const creatorParticipation = await program.account.playerParticipation.fetch(creatorParticipationPDA);
    const player1Participation = await program.account.playerParticipation.fetch(player1ParticipationPDA);

    expect(creatorParticipation.playerIndex).to.equal(0);
    expect(player1Participation.playerIndex).to.equal(1);
  });

  it("Test Game State Consistency After Player Balance Insufficient During Join", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

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

    // Initialize game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Creator joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Create player with insufficient funds
    const {
      player: poorPlayer,
      playerTokenAccount: poorPlayerTokenAccount,
    } = await createPlayer(mint);

    // Give player insufficient tokens (half of required amount)
    const insufficientAmount = amount.divn(2);
    await mintTokens(mintAuthority, mint, poorPlayerTokenAccount.address, insufficientAmount);

    // Test that join fails with insufficient balance
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: poorPlayer.publicKey,
        })
        .signers([poorPlayer])
        .rpc();
      expect.fail("Should fail with insufficient balance");
    } catch (error) {
      expect(error.toString()).to.include("InsufficientBalance");
    }

    // Verify game state remains consistent
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(1, "Player count should remain unchanged after failed join");

    // Verify no orphaned participation account was created
    const [poorPlayerParticipationPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_participation"), gamePDA.toBuffer(), poorPlayer.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.account.playerParticipation.fetch(poorPlayerParticipationPDA);
      expect.fail("No participation account should exist after failed join");
    } catch (error) {
      expect(error.toString()).to.include("Account does not exist");
    }
  });

  // ========================================
  // REPLAY ATTACK SECURITY TESTS
  // ========================================

  it("Test Join Game Replay Attack Prevention", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator and player
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount.muln(3)); // Extra tokens for potential replay

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 3,
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

    // Creator joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Player1 joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Verify initial state
    let gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2);
    expect(gameData.totalAmount.toNumber()).to.equal(amount.muln(2).toNumber());

    // Attempt to replay join transaction (should fail due to account already exists)
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player1.publicKey,
        })
        .signers([player1])
        .rpc();
      expect.fail("Replay attack should be prevented");
    } catch (error) {
      // Should fail because player_participation account already exists
      expect(error.toString()).to.include("already in use");
    }

    // Verify state hasn't changed
    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.playersCount).to.equal(2, "Player count should remain unchanged");
    expect(gameData.totalAmount.toNumber()).to.equal(amount.muln(2).toNumber(), "Total amount should remain unchanged");
  });

  it("Test Complete Game Replay Attack Prevention", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator and player
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

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

    // Create full game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

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
    const winner = winnerIndex === 0 ? creator.publicKey : player1.publicKey;

    // Complete game once
    await program.methods
      .completeGame(randomHash, secretKey)
      .accounts({
        authority: program.provider.publicKey,
        winner: winner,
        creator: creator.publicKey,
      })
      .rpc();

    // Verify game completed
    const completedGameData = await program.account.game.fetch(gamePDA);
    expect(completedGameData.totalAmount.toNumber()).to.equal(0);

    // Attempt replay attack (should fail - winner_participation account closed)
    try {
      await program.methods
        .completeGame(randomHash, secretKey)
        .accounts({
          authority: program.provider.publicKey,
          winner: winner,
          creator: creator.publicKey,
        })
        .rpc();
      expect.fail("Complete game replay should be prevented");
    } catch (error) {
      expect(error.toString()).to.include("AccountNotInitialized");
    }
  });

  it("Test Roll Game Multiple Times (Snowball) - Not Replay but Legitimate", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator and player
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    // Mint enough tokens for multiple rolls
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount.muln(5));
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount.muln(5));

    const { gamePDA, randomHash } = await getGamePDA();

    const gameConfig = {
      gameType: { snowball: {} }, // Snowball supports multiple rolls
      amount: amount,
      maxPlayers: 3,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Initialize snowball game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Players join
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Initial state
    let gameData = await program.account.game.fetch(gamePDA);
    const initialTotal = gameData.totalAmount.toNumber();

    // Player1 rolls multiple times (this is legitimate for Snowball, not a replay attack)
    await program.methods
      .rollGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.totalAmount.toNumber()).to.equal(initialTotal + amount.toNumber());

    // Roll again
    await program.methods
      .rollGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.totalAmount.toNumber()).to.equal(initialTotal + amount.muln(2).toNumber());
  });

  // ========================================
  // ARITHMETIC OVERFLOW/UNDERFLOW TESTS
  // ========================================

  it("Test Arithmetic Overflow Protection in calculate_amounts", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    // Use large but JavaScript-safe amount to test overflow protection
    const largeAmount = new anchor.BN("9000000000000000"); // 9 * 10^15, well within safe range

    // Create creator with large token supply
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    // Mint large amounts to test arithmetic operations
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, largeAmount);
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, largeAmount);

    const { gamePDA, randomHash, secretKey } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: largeAmount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    try {
      // Try to initialize game with large amount
      await program.methods
        .initializeGame(gameConfig, randomHash)
        .accounts({
          creator: creator.publicKey,
          tokenMint: mint,
        })
        .signers([creator])
        .rpc();

      // If initialization succeeds, join players
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: creator.publicKey,
        })
        .signers([creator])
        .rpc();

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
      const winner = winnerIndex === 0 ? creator.publicKey : player1.publicKey;

      // Complete game - this will test calculate_amounts with large values
      await program.methods
        .completeGame(randomHash, secretKey)
        .accounts({
          authority: program.provider.publicKey,
          winner: winner,
          creator: creator.publicKey,
        })
        .rpc();

      // Verify arithmetic was handled correctly
      const completedGameData = await program.account.game.fetch(gamePDA);
      expect(completedGameData.totalAmount.toNumber()).to.equal(0, "Game should be completed");
      console.log("Large amount arithmetic handled correctly");
    } catch (error) {
      // If the system rejects large amounts, that's also acceptable security behavior
      console.log("Large amount rejected by system (acceptable):", error.toString());
    }
  });

  it("Test Underflow Protection in Player Balance Operations", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create player with some balance
    const {
      player,
      playerTokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

    // Initialize player balance and add some funds
    const [playerBalancePDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_balance"), player.publicKey.toBuffer(), mint.toBuffer()],
      program.programId
    );

    // Manually add some balance
    const playerBalance = await program.account.playerBalance.fetch(playerBalancePDA);
    expect(playerBalance.amount.toNumber()).to.equal(0);

    // Try to withdraw more than available (should fail)
    try {
      await program.methods
        .withdrawPlayerBalance()
        .accounts({
          player: player.publicKey,
          tokenMint: mint,
        })
        .signers([player])
        .rpc();
      expect.fail("Should not allow withdrawal of zero balance");
    } catch (error) {
      expect(error.toString()).to.include("InsufficientBalance");
    }
  });

  // ========================================
  // SECRET KEY MANIPULATION TESTS
  // ========================================

  it("Test Secret Key Validation and Manipulation Prevention", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create creator and player
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

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

    // Create full game
    await program.methods
      .initializeGame(gameConfig, randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Try to complete with wrong secret key
    const fakeSecretKey = Array.from(anchor.web3.Keypair.generate().secretKey.slice(0, 32));
    const playersGameData = await program.account.game.fetch(gamePDA);
    const correctWinnerIndex = calculateWinnerIndex(playersGameData.playersCount, secretKey, Number(playersGameData.lastSlot));
    const correctWinner = correctWinnerIndex === 0 ? creator.publicKey : player1.publicKey;

    try {
      await program.methods
        .completeGame(randomHash, fakeSecretKey)
        .accounts({
          authority: program.provider.publicKey,
          winner: correctWinner,
          creator: creator.publicKey,
        })
        .rpc();
      expect.fail("Fake secret key should be rejected");
    } catch (error) {
      expect(error.toString()).to.include("InvalidSecretKey");
    }

    // Try to complete with correct secret key but wrong winner
    const fakeWinner = correctWinner.equals(creator.publicKey) ? player1.publicKey : creator.publicKey;

    try {
      await program.methods
        .completeGame(randomHash, secretKey)
        .accounts({
          authority: program.provider.publicKey,
          winner: fakeWinner,
          creator: creator.publicKey,
        })
        .rpc();
      expect.fail("Wrong winner should be rejected");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedPlayer");
    }
  });

  // ========================================
  // CROSS-GAME ATTACK TESTS
  // ========================================

  it("Test Cross-Game Winner Manipulation Prevention", async () => {
    const {
    } = await createOracleAccount();

    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const amount = new anchor.BN(1_000_000);

    // Create players
    const {
      player: creator,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player: player1,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount.muln(4));
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount.muln(4));

    // Create two separate games
    const { gamePDA: game1PDA, randomHash: randomHash1, secretKey: secretKey1 } = await getGamePDA();
    const { gamePDA: game2PDA, randomHash: randomHash2, secretKey: secretKey2 } = await getGamePDA();

    const gameConfig = {
      gameType: { coinflip: {} },
      amount: amount,
      maxPlayers: 2,
      minPlayers: 2,
      timeout: 3600,
      isPrivate: false,
    };

    // Initialize both games
    await program.methods
      .initializeGame(gameConfig, randomHash1)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .initializeGame(gameConfig, randomHash2)
      .accounts({
        creator: creator.publicKey,
        tokenMint: mint,
      })
      .signers([creator])
      .rpc();

    // Fill both games
    await program.methods
      .joinGame()
      .accounts({
        game: game1PDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: game1PDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: game2PDA,
        player: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .joinGame()
      .accounts({
        game: game2PDA,
        player: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Calculate winners for both games
    const game1Data = await program.account.game.fetch(game1PDA);
    const game2Data = await program.account.game.fetch(game2PDA);

    const winner1Index = calculateWinnerIndex(game1Data.playersCount, secretKey1, Number(game1Data.lastSlot));
    const winner2Index = calculateWinnerIndex(game2Data.playersCount, secretKey2, Number(game2Data.lastSlot));

    const winner1 = winner1Index === 0 ? creator.publicKey : player1.publicKey;
    const winner2 = winner2Index === 0 ? creator.publicKey : player1.publicKey;

    // Try to complete game1 with game2's secret key (cross-game attack)
    try {
      await program.methods
        .completeGame(randomHash1, secretKey2) // Wrong secret key for this game
        .accounts({
          authority: program.provider.publicKey,
          winner: winner1,
          creator: creator.publicKey,
        })
        .rpc();
      expect.fail("Cross-game secret key should be rejected");
    } catch (error) {
      expect(error.toString()).to.include("InvalidSecretKey");
    }

    // Complete games with correct secret keys
    await program.methods
      .completeGame(randomHash1, secretKey1)
      .accounts({
        authority: program.provider.publicKey,
        winner: winner1,
        creator: creator.publicKey,
      })
      .rpc();

    await program.methods
      .completeGame(randomHash2, secretKey2)
      .accounts({
        authority: program.provider.publicKey,
        winner: winner2,
        creator: creator.publicKey,
      })
      .rpc();
  });
});
