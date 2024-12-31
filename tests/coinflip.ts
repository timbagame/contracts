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
    const oracleBufferTime = 3600;

    // Airdrop SOL to authority for rent
    const signature = await program.provider.connection.requestAirdrop(
      program.provider.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(signature);

    try {
      await program.methods
        .initializeOracle(feePercentage, new BN(oracleBufferTime), 100, new BN(36000), new BN(360))
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
      vaultTokenAccount: vaultTokenAccountInfo.address,
      mintAuthority,
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
    // Get current config and oracle
    await createOracleAccount();

    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    // Create treasury token account
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
        tokenMint: mint,
      })
      .rpc();

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
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
      })
      .rpc();

    // Try to claim as non-winner
    try {
      await program.methods
        .claimWin()
        .accounts({
          game: gamePDA,
          winner: player.publicKey,
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
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);

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
        tokenMint: mint,
      })
      .rpc();

    // Get game PDA
    const gameId = await getLastGameId();
    const gamePDA = await getGamePDA(gameId);

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
    await createOracleAccount();
    const {
      mint,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const maxParticipants = 5;
    const minParticipants = 1;
    const timeoutDuration = new BN(3600);
    const isPrivate = false;

    // Get current game counter for PDA derivation
    const gameCounter = await getLastGameId();

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
        tokenMint: mint,
      })
      .rpc();

    // Get game PDA
    const gamePDA = await getGamePDA(gameCounter);

    // Verify game state - creator should not be added as participant for giveaway
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.players.length).to.equal(0);
    expect(gameData.gameType.giveaway).to.not.be.undefined;
  });

  it("Multiple Participants Can Claim Timeout", async () => {
    await createOracleAccount();
    const {
      mint,
      creatorTokenAccount,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getLastGameId();

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

    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
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

    // Join game
    await program.methods
      .joinGame()
      .accounts({
        game: gamePDA,
        player: player.publicKey,
      })
      .signers([player])
      .rpc();

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 5000));

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
        participant: program.provider.publicKey,
      })
      .rpc();

    // Player claims timeout
    await program.methods
      .unjoinGame()
      .accounts({
        game: gamePDA,
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
    expect(gameData.players.length).to.equal(0);
  });

  it("Fail to Claim Timeout as Non-Participant", async () => {
    await createOracleAccount();
    const {
      mint,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getLastGameId();

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


    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Try to claim timeout as non-participant
    try {
      await program.methods
        .unjoinGame()
        .accounts({
          game: gamePDA,
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
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getLastGameId();

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
      const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
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
        })
        .signers([player])
        .rpc();
    }

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
      })
      .rpc();

    // Verify game state
    const gameData = await program.account.game.fetch(gamePDA);
    expect(gameData.status.readyForClaim).to.not.be.undefined;
    expect(gameData.oracleHash).to.deep.equal(hashValue);
    expect(gameData.winner).to.not.be.null;
  });

  it("Cannot Claim Winnings Multiple Times", async () => {
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    // Create and setup player
    const player = anchor.web3.Keypair.generate();
    const playerAirdrop = await program.provider.connection.requestAirdrop(
      player.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await program.provider.connection.confirmTransaction(playerAirdrop);

    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      player,
      mint,
      player.publicKey,
    );

    // Create treasury token account

    const amount = new BN(1_000_000);
    const gameCounter = await getLastGameId();

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
      })
      .rpc();

    // Get game data to find winner
    const gameData = await program.account.game.fetch(gamePDA);
    const winner = gameData.winner;
    expect(winner).to.not.be.null;

    // Get winner's token account

    // Claim winnings first time
    await program.methods
      .claimWin()
      .accounts({
        game: gamePDA,
      })
      .signers(winner.equals(program.provider.publicKey) ? [] : [player])
      .rpc();

    // Try to claim winnings second time
    try {
      await program.methods
        .claimWin()
        .accounts({
          game: gamePDA,
        })
        .signers(winner.equals(program.provider.publicKey) ? [] : [player])
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
        tokenMint: mint,
      })
      .rpc();

    // Get current game counter for PDA derivation
    const gameCounter = await getLastGameId();
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

    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
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
        })
        .signers([player])
        .rpc();

      expect.fail("Should not be able to join with insufficient funds");
    } catch (error) {
      expect(error.toString()).to.include("insufficient funds");
    }
  });

  it("Cannot Initialize Game with Negative or Zero Timeout", async () => {
    await createOracleAccount();
    const {
      mint,
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
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should have thrown error for zero timeout");
    } catch (error) {
      expect(error.toString()).to.include("InvalidTimeout");
    }
  });

  it("Cannot Initialize Game with Amount Overflow", async () => {
    await createOracleAccount();
    const {
      mint,
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
          tokenMint: mint,
        })
        .rpc();

      expect.fail("Should have thrown error for potential pot amount overflow");
    } catch (error) {
      expect(error.toString()).to.include("InvalidParticipantCount");
    }
  });

  it("Cannot Join Game With Different Token Mint", async () => {
    await createOracleAccount();
    const {
      mint,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getLastGameId();

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

    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
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
        })
        .signers([player])
        .rpc();

      expect.fail("Should not be able to join with different token mint");
    } catch (error) {
      expect(error.toString()).to.include("InvalidToken");
    }
  });

  it("Can Cancel Bet Before Game is Full", async () => {
    await createOracleAccount();
    const {
      mint,
      creatorTokenAccount,
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getLastGameId();

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
    expect(gameData.players.length).to.equal(0);
  });

  it("Cannot Cancel Bet When Game is Full", async () => {
    await createOracleAccount();
    const {
      mint,
      mintAuthority
    } = await createSplTokenMint();

    const amount = new BN(1_000_000);
    const gameCounter = await getLastGameId();

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

    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
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
      })
      .signers([player])
      .rpc();

    // Try to cancel bet when game is full
    try {
      await program.methods
        .unjoinGame()
        .accounts({
          game: gamePDA,
          participant: program.provider.publicKey,
        })
        .rpc();

      expect.fail("Should not be able to cancel when game is full");
    } catch (error) {
      expect(error.toString()).to.include("GameFull");
    }
  });
});
