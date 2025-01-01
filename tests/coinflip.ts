import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  createMint,
  getAccount,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

describe("coinflip", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as Program<Coinflip>;

  // Add helper functions at the top level
  async function getLastGameId() {
    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      program.programId
    );
    const oracleAccount = await program.account.oracle.fetch(oraclePDA);
    return oracleAccount.gamesCounter.sub(new BN(1));
  }

  async function getGamePDA(gameCounter: BN) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameCounter.toArrayLike(Buffer, 'le', 8)],
      program.programId
    )[0];
  }
  // Add this before all tests
  before(async () => {
    // Initialize oracle once for all tests
    const feePercentage = 1;
    const oracleBufferTime = 2;
    const maxPlayers = 100;
    const maxTimeout = 86400;
    const minTimeout = 1;

    // Airdrop SOL to authority for rent
    const signature = await program.provider.connection.requestAirdrop(
      program.provider.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(signature);

    try {
      await program.methods
        .initializeOracle(feePercentage, new BN(oracleBufferTime), maxPlayers, new BN(maxTimeout), new BN(minTimeout))
        .accounts({
          payer: program.provider.publicKey,
          authority: program.provider.publicKey,
        })
        .rpc();

      // Create token mint and initialize token
      await createSplTokenMint();

      // Initialize player for tests
      await program.methods
        .initializePlayer()
        .accounts({
          payer: program.provider.publicKey,
          owner: program.provider.publicKey,
        })
        .rpc();

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
      gamesCounter: oracleAccount.gamesCounter,
      playersCounter: oracleAccount.playersCounter,
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

    // Get vault PDA using token mint
    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
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

    // Create token account for oracle authority
    const oracleAuthorityTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority, // payer
      mint,
      program.provider.publicKey, // oracle authority
    );

    // Try to initialize token, if it fails it may already exist
    try {
      await program.methods
        .initializeToken("TEST", new BN(1000), true)
        .accounts({
          tokenMint: mint,
          payer: program.provider.publicKey,
          authority: program.provider.publicKey,
        })
        .rpc();
    } catch (e) {
      // Token may already be initialized, that's fine
      console.log("Token initialization failed, may already exist:", e);
    }

    return {
      mint,
      vaultTokenAccountInfo,
      mintAuthority,
      oracleAuthorityTokenAccount,
    };
  }

  async function mintTokens(mintAuthority: anchor.web3.Keypair, tokenMint: PublicKey, playerTokenAccount: PublicKey, amount: BN) {
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

    // Initialize player for tests
    await program.methods
      .initializePlayer()
      .accounts({
        payer: player.publicKey,
        owner: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Get player PDA
    const [playerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player"), player.publicKey.toBuffer()],
      program.programId
    );

    const [playerVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_vault"), playerPDA.toBuffer(), tokenMint.toBuffer()],
      program.programId
    );

    // get or create player token account
    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      player, // payer
      tokenMint,
      playerVaultPDA,
      true, // allowOwnerOffCurve
    );

    return {
      player,
      playerPDA,
      playerVaultPDA,
      playerTokenAccount,
    };
  }


  it("Initialize Oracle Successfully", async () => {
    const { authority, feePercentage, oracleBufferTime, gamesCounter, playersCounter } = await createOracleAccount();

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
    expect(oracleData.gamesCounter.toString()).to.equal(gamesCounter.toString());
    expect(oracleData.playersCounter.toString()).to.equal(playersCounter.toString());
  });

  it("Initialize Game with Invalid Parameters", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, playerTokenAccount.address, new BN(1_000_000));

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
          creator: playerPDA,
          signer: player.publicKey,
          payer: player.publicKey,
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
    await createOracleAccount();
    const {
      mint,
      mintAuthority,
    } = await createSplTokenMint();

    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, new BN(1_000_000));
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, new BN(1_000_000));

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerPDA,
        owner: player.publicKey,
        authority: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.players[1].toString()).to.equal(playerPDA.toString());
  });

  it("Join Private Game Successfully", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create joiner using helper  
    const {
      player: joiner,
      playerPDA: joinerPDA,
      playerTokenAccount: joinerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    const amount = new BN(1_000_000);
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, joinerTokenAccount.address, amount);

    // Initialize game with isPrivate = true
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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game with both player and oracle signatures
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: joinerPDA,
        owner: joiner.publicKey,
        authority: program.provider.publicKey,
      })
      .signers([joiner])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.players[1].toString()).to.equal(joinerPDA.toString());
  });

  it("Fail to Join Full Game", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Create first player
    const {
      player: player1,
      playerPDA: player1PDA,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    // Create second player
    const {
      player: player2,
      playerPDA: player2PDA,
      playerTokenAccount: player2TokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to players
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player2TokenAccount.address, amount);

    // First player joins successfully
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1PDA,
        owner: player1.publicKey,
        authority: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Second player attempts to join - should fail
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player2PDA,
          owner: player2.publicKey,
          authority: player2.publicKey,
        })
        .signers([player2])
        .rpc();

      expect.fail("Should have thrown GameFull error");
    } catch (error) {
      expect(error.toString()).to.include("GameFull");
    }
  });

  it("Fail to Join Game Twice", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Create player
    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to player
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount.muln(2)); // Enough for two attempts

    // First join should succeed
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerPDA,
        owner: player.publicKey,
        authority: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Second join should fail
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: playerPDA,
          owner: player.publicKey,
          authority: player.publicKey,
        })
        .signers([player])
        .rpc();

      expect.fail("Should have thrown AlreadyJoined error");
    } catch (error) {
      expect(error.toString()).to.include("AlreadyJoined");
    }
  });

  it("Fail to Join Private Game with Wrong Authority", async () => {
    // Initialize config
    await createOracleAccount();

    // Create SPL token setup
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Create player
    const {
      player,
      playerPDA,
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
          player: playerPDA,
          owner: player.publicKey,
          authority: fakeAuthority.publicKey,
        })
        .signers([player, fakeAuthority])
        .rpc();

      expect.fail("UnauthorizedPlayer");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedPlayer");
    }
  });

  it("Set Oracle Hash Successfully", async () => {
    await createOracleAccount();

    // Create SPL token setup
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get current game counter for PDA derivation
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game with second player
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerPDA,
        owner: player.publicKey,
        authority: player.publicKey,
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
        authority: program.provider.publicKey,
      })
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.status.readyForClaim).to.not.be.undefined;
    expect(gameData.winner).to.not.be.null;
  });

  it("Fail to Set Oracle Hash Without Oracle Authority", async () => {
    await createOracleAccount();

    // Create SPL token setup
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get current game counter for PDA derivation
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game with second player
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerPDA,
        owner: player.publicKey,
        authority: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Try to set oracle hash with fake oracle authority
    const fakeAuthority = anchor.web3.Keypair.generate();
    try {
      const hashValue = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 256),
      );
      await program.methods
        .setOracleHash(hashValue)
        .accounts({
          game: gamePDA,
          authority: fakeAuthority.publicKey,
        })
        .signers([fakeAuthority])
        .rpc();

      expect.fail("Should have thrown UnauthorizedOracle error");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedOracle");
    }
  });

  it("Fail to Set Oracle Hash Before Game is Full", async () => {
    await createOracleAccount();

    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Try to set oracle hash before game is full
    try {
      const hashValue = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 256),
      );
      await program.methods
        .setOracleHash(hashValue)
        .accounts({
          game: gamePDA,
          authority: program.provider.publicKey,
        })
        .rpc();

      expect.fail("Should have thrown GameNotFull error");
    } catch (error) {
      expect(error.toString()).to.include("GameNotFull");
    }
  });

  it("Fail to Set Oracle Hash Twice", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Create and join with second player
    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to player
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerPDA,
        owner: player.publicKey,
        authority: player.publicKey,
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
        authority: program.provider.publicKey,
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
          authority: program.provider.publicKey,
        })
        .rpc();

      expect.fail("Should have thrown GameNotActive error");
    } catch (error) {
      expect(error.toString()).to.include("GameNotActive");
    }
  });

  it("Claim Winnings Successfully", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both players
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerPDA,
        owner: player.publicKey,
        authority: player.publicKey,
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
        authority: program.provider.publicKey,
      })
      .rpc();

    // Get game data to find winner
    const gameData = await program.account.game.fetch(gamePDA);
    const winner = gameData.winner;
    expect(winner).to.not.be.null;
    let winnerOwner;
    if (winner.equals(creatorPDA)) {
      winnerOwner = creator;
    } else if (winner.equals(playerPDA)) {
      winnerOwner = player;
    } else {
      expect.fail("Invalid winner");
    }

    // Get winner's token account
    const winnerTokenAccount = winner.equals(creatorPDA)
      ? creatorTokenAccount.address
      : playerTokenAccount.address;

    // Get initial balances
    const initialBalance = (
      await getAccount(program.provider.connection, winnerTokenAccount)
    ).amount;

    // Claim winnings
    await program.methods
      .claimWin()
      .accounts({
        game: gamePDA,
        winner: winner,
        signer: winnerOwner.publicKey,
      })
      .signers([winnerOwner])
      .rpc();

    // Verify winner received funds
    const finalBalance = (
      await getAccount(program.provider.connection, winnerTokenAccount)
    ).amount;

    // Calculate expected winnings (amount * 2 - fees)
    const totalPot = amount.toNumber() * 2 * 0.99;
    const expectedWinnings = BigInt(totalPot);
    expect(finalBalance - initialBalance).to.equal(expectedWinnings);
  });

  it("Fail to Claim as Non-Winner", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both players
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: playerPDA,
        owner: player.publicKey,
        authority: player.publicKey,
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
        authority: program.provider.publicKey,
      })
      .rpc();

    // Get game data to find winner
    const gameData = await program.account.game.fetch(gamePDA);
    const winner = gameData.winner;
    expect(winner).to.not.be.null;

    // Try to claim as non-winner (the player who didn't win)
    const nonWinner = winner.equals(creatorPDA) ? playerPDA : creatorPDA;
    const nonWinnerKeypair = winner.equals(creatorPDA) ? player : creator;

    try {
      await program.methods
        .claimWin()
        .accounts({
          game: gamePDA,
          winner: nonWinner,
          signer: nonWinnerKeypair.publicKey,
        })
        .signers([nonWinnerKeypair])
        .rpc();

      expect.fail("Should have thrown UnauthorizedPlayer error");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedPlayer");
    }
  });

  it("Claim Timeout When Game Expires", async () => {
    // Create game with short timeout
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Get initial balance
    const initialBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount.address)
    ).amount;

    // Claim timeout
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        player: creatorPDA,
        signer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Verify funds returned
    const finalBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount.address)
    ).amount;
    expect(finalBalance - initialBalance).to.equal(BigInt(amount.toString()));
  });

  it("Initialize and Join Giveaway Game Successfully", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const maxParticipants = 2;
    const minParticipants = 1;
    const timeoutDuration = new BN(3600);
    const isPrivate = false;

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create first player using helper
    const {
      player: player1,
      playerPDA: player1PDA,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player: player2,
      playerPDA: player2PDA,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // First player joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1PDA,
        owner: player1.publicKey,
        authority: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Second player joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player2PDA,
        owner: player2.publicKey,
        authority: player2.publicKey,
      })
      .signers([player2])
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.players.length).to.equal(2);
    expect(gameData.gameType.giveaway).to.not.be.undefined;
    expect(gameData.creator.equals(creatorPDA)).to.be.true;
  });

  it("Multiple Participants Can Claim Timeout", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player: player2,
      playerPDA: player2PDA,
      playerTokenAccount: player2TokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both players
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player2TokenAccount.address, amount);

    // Initialize game with short timeout
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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Second player joins
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player2PDA,
        owner: player2.publicKey,
        authority: player2.publicKey,
      })
      .signers([player2])
      .rpc();

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Get initial balances
    const initialBalance1 = (
      await getAccount(program.provider.connection, creatorTokenAccount.address)
    ).amount;
    const initialBalance2 = (
      await getAccount(program.provider.connection, player2TokenAccount.address)
    ).amount;

    // Both players claim timeout
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        player: creatorPDA,
        signer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        player: player2PDA,
        signer: player2.publicKey,
      })
      .signers([player2])
      .rpc();

    // Verify funds returned
    const finalBalance1 = (
      await getAccount(program.provider.connection, creatorTokenAccount.address)
    ).amount;
    const finalBalance2 = (
      await getAccount(program.provider.connection, player2TokenAccount.address)
    ).amount;

    expect(finalBalance1 - initialBalance1).to.equal(BigInt(amount.toString()));
    expect(finalBalance2 - initialBalance2).to.equal(BigInt(amount.toString()));
  });

  it("Fail to Claim Timeout as Non-Participant", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create non-participant using helper
    const {
      player: nonParticipant,
      playerPDA: nonParticipantPDA,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

    // Initialize game with short timeout
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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 4000));

    try {
      // Try to claim timeout as non-participant
      await program.methods
        .unjoinGame()
        .accounts({
          game: gamePDA,
          player: nonParticipantPDA,
          signer: nonParticipant.publicKey,
        })
        .signers([nonParticipant])
        .rpc();

      expect.fail("Should have thrown UnauthorizedPlayer error");
    } catch (error) {
      expect(error.toString()).to.include("UnauthorizedPlayer");
    }
  });

  it("Set Oracle Hash When Minimum Participants Met and Timeout Passed", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create player using helper
    const {
      player: player1,
      playerPDA: player1PDA,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game with player1
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1PDA,
        owner: player1.publicKey,
        authority: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        authority: program.provider.publicKey,
      })
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.status.readyForClaim).to.not.be.undefined;
    expect(gameData.winner).to.not.be.null;
  });

  it("Cannot Claim Winnings Multiple Times", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player: player1,
      playerPDA: player1PDA,
      playerTokenAccount: player1TokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both accounts
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player1TokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game with player1
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player1PDA,
        owner: player1.publicKey,
        authority: player1.publicKey,
      })
      .signers([player1])
      .rpc();

    // Set oracle hash
    const hashValue = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256),
    );
    await program.methods
      .setOracleHash(hashValue)
      .accounts({
        game: gamePDA,
        authority: program.provider.publicKey,
      })
      .rpc();

    // Get game data to find winner
    const gameData = await program.account.game.fetch(gamePDA);
    const winner = gameData.winner;
    expect(winner).to.not.be.null;

    // Get winner's keypair and PDA
    const winnerKeypair = winner.equals(creatorPDA) ? creator : player1;

    // Claim winnings first time
    await program.methods
      .claimWin()
      .accounts({
        game: gamePDA,
        winner: winner,
        signer: winnerKeypair.publicKey,
      })
      .signers([winnerKeypair])
      .rpc();

    // Try to claim winnings second time
    try {
      await program.methods
        .claimWin()
        .accounts({
          game: gamePDA,
          winner: winner,
          signer: winnerKeypair.publicKey,
        })
        .signers([winnerKeypair])
        .rpc();

      expect.fail("Should not be able to claim winnings twice");
    } catch (error) {
      expect(error.toString()).to.include("GameNotReadyForClaim");
    }
  });

  it("Cannot Join Game With Insufficient Funds", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Create player with insufficient funds
    const {
      player,
      playerPDA,
      playerTokenAccount,
    } = await createPlayer(mint);

    // Mint insufficient tokens to player (half of required amount)
    await mintTokens(mintAuthority, mint, playerTokenAccount.address, amount.divn(2));

    // Attempt to join game
    try {
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: playerPDA,
          owner: player.publicKey,
          authority: player.publicKey,
        })
        .signers([player])
        .rpc();

      expect.fail("Should not be able to join with insufficient funds");
    } catch (error) {
      expect(error.toString()).to.include("InsufficientBalance");
    }
  });

  it("Can Unjoin Game Before it's Full", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to creator
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Get initial balance
    const initialBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount.address)
    ).amount;

    // Claim timeout (cancel bet) before game is full
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
        player: creatorPDA,
        signer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    // Verify funds were returned
    const finalBalance = (
      await getAccount(program.provider.connection, creatorTokenAccount.address)
    ).amount;
    expect(finalBalance - initialBalance).to.equal(BigInt(amount.toString()));

    // Verify participant was removed
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.players.length).to.equal(0);
  });

  it("Cannot Unjoin Game When it's Full", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

    // Create creator using helper
    const {
      player: creator,
      playerPDA: creatorPDA,
      playerTokenAccount: creatorTokenAccount,
    } = await createPlayer(mint);

    // Create second player using helper
    const {
      player: player2,
      playerPDA: player2PDA,
      playerTokenAccount: player2TokenAccount,
    } = await createPlayer(mint);

    // Mint tokens to both players
    await mintTokens(mintAuthority, mint, creatorTokenAccount.address, amount);
    await mintTokens(mintAuthority, mint, player2TokenAccount.address, amount);

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
        creator: creatorPDA,
        tokenMint: mint,
        signer: creator.publicKey,
        payer: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

    // Join game with second player to make it full
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player2PDA,
        owner: player2.publicKey,
        authority: player2.publicKey,
      })
      .signers([player2])
      .rpc();

    // Try to cancel bet when game is full
    try {
      await program.methods
        .unjoinGame()
        .accounts({
          game: gamePDA,
          player: creatorPDA,
          signer: creator.publicKey,
        })
        .signers([creator])
        .rpc();

      expect.fail("Should not be able to cancel when game is full");
    } catch (error) {
      expect(error.toString()).to.include("GameReadyForOracle");
    }
  });
});
