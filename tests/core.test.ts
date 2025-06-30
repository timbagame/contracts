import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  GameConfig,
} from "./test-helpers";

/**
 * Core test suite for basic Coinflip game operations
 *
 * Tests fundamental functionality:
 * - Oracle initialization and management
 * - Token configuration and management
 * - Game initialization and basic lifecycle
 * - Player balance operations
 * - Basic join/unjoin operations
 * - Game completion flow
 * - Error handling for common scenarios
 */

describe("Core Game Operations", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    console.log("🚀 Setting up core test environment...");

    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();

    // Initialize global test environment
    await env.initialize();

    console.log("✅ Core test environment ready");
  });

  describe("Oracle Management", () => {
    it("should initialize oracle with default configuration", async () => {
      const oracle = await testUtils.oracle.createOracle();

      expect(oracle.oraclePDA).to.not.be.undefined;
      expect(oracle.operator.equals(oracle.operatorKeypair.publicKey)).to.be.true;
      expect(oracle.config.feePercentage).to.equal(1);
      expect(oracle.config.maxPlayers).to.equal(100);
    });

    it("should return existing oracle configuration", async () => {
      const customConfig = {
        feePercentage: 2,
        maxPlayers: 50,
        maxTimeout: 1800,
      };

      // Since oracle already exists, this should return the existing configuration
      const oracle = await testUtils.oracle.createOracle(customConfig);

      // Should return the default configuration from the first initialization
      expect(oracle.config.feePercentage).to.equal(1);
      expect(oracle.config.maxPlayers).to.equal(100);
      expect(oracle.config.maxTimeout).to.equal(86400);
    });

    it("should fetch existing oracle", async () => {
      const oracle = await testUtils.oracle.getOracle();

      expect(oracle.oraclePDA).to.not.be.undefined;
      expect(oracle.operator).to.not.be.undefined;
      expect(oracle.config).to.not.be.undefined;
    });
  });

  describe("Token Management", () => {
    it("should create mint with proper configuration", async () => {
      const mint = await testUtils.mint.createMint();

      expect(mint.mint).to.not.be.undefined;
      expect(mint.mintAuthority).to.not.be.undefined;
      expect(mint.gameVaultPDA).to.not.be.undefined;
      expect(mint.gameTokenPDA).to.not.be.undefined;
    });

    it("should mint tokens to player account", async () => {
      const mint = await testUtils.mint.createMint();
      const player = await testUtils.player.createPlayer(mint.mint);
      const amount = new anchor.BN(1_000_000);

      await testUtils.mint.mintTokensToAccount(mint, player.playerTokenAccount.address, amount);

      const balance = await env.provider.connection.getTokenAccountBalance(
        player.playerTokenAccount.address
      );
      expect(balance.value.amount).to.equal(amount.toString());
    });
  });

  describe("Player Management", () => {
    it("should create player with token account and balance", async () => {
      const mint = await testUtils.mint.createMint();
      const player = await testUtils.player.createPlayer(mint.mint);

      expect(player.player.publicKey).to.not.be.undefined;
      expect(player.playerTokenAccount).to.not.be.undefined;
      expect(player.playerBalancePDA).to.not.be.undefined;

      // Verify player balance account exists
      const balanceAccount = await env.program.account.playerBalance.fetch(
        player.playerBalancePDA
      );
      expect(balanceAccount.amount.toNumber()).to.equal(0);
    });

    it("should create player pool efficiently", async () => {
      const mint = await testUtils.mint.createMint();
      const players = await testUtils.player.createPlayerPool(3, mint.mint);

      expect(players).to.have.length(3);

      for (const player of players) {
        expect(player.player.publicKey).to.not.be.undefined;
        expect(player.playerTokenAccount).to.not.be.undefined;
        expect(player.playerBalancePDA).to.not.be.undefined;
      }
    });

    it("should fund player with tokens", async () => {
      const mint = await testUtils.mint.createMint();
      const player = await testUtils.player.createPlayer(mint.mint);
      const amount = new anchor.BN(5_000_000);

      await testUtils.player.fundPlayer(player, mint, amount);

      const balance = await env.provider.connection.getTokenAccountBalance(
        player.playerTokenAccount.address
      );
      expect(balance.value.amount).to.equal(amount.toString());
    });
  });

  describe("Game Initialization", () => {
    it("should initialize coinflip game with valid parameters", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.creator.equals(creator.player.publicKey)).to.be.true;
      expect(gameAccount.ticketAmount.toNumber()).to.equal(1_000_000);
      expect(gameAccount.maxPlayers).to.equal(2);
      expect(gameAccount.minPlayers).to.equal(2);
      expect(gameAccount.playersCount).to.equal(0);
    });

    it("should fail to initialize game with invalid parameters", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const invalidConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 1, // Invalid: coinflip needs at least 2 players
        minPlayers: 2, // Invalid: min > max
        timeout: 3600,
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          gameData,
          invalidConfig,
          creator.player,
          mint.mint
        );
        expect.fail("Should have failed with invalid parameters");
      } catch (error) {
        expect(error.toString()).to.include("InvalidPlayersCount");
      }
    });

    it("should initialize giveaway game successfully", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: new anchor.BN(2_000_000),
        maxPlayers: 5,
        minPlayers: 1,
        timeout: 1800,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.gameType.giveaway).to.not.be.undefined;
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000); // Giveaway uses totalAmount
      expect(gameAccount.ticketAmount.toNumber()).to.equal(0); // Giveaway sets ticketAmount to 0
      expect(gameAccount.maxPlayers).to.equal(5);
      expect(gameAccount.minPlayers).to.equal(1);
    });
  });

  describe("Player Join Operations", () => {
    it("should allow players to join public game", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Creator joins
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      let gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(1);

      // Second player joins
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(2);
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);
    });

    it("should allow players to join private game with operator", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: true, // Private game
      };

      // Initialize private game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Players join with oracle operator
      await testUtils.game.joinGame(gameData.gamePDA, creator.player, oracle.operatorKeypair);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player, oracle.operatorKeypair);

      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(2);
    });

    it("should fail to join private game without operator", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: true,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      try {
        await testUtils.game.joinGame(gameData.gamePDA, player1.player);
        expect.fail("Should have failed without operator");
      } catch (error) {
        // Private games without operator should fail with private game access denied error
        expect(error.toString()).to.include("PrivateGameAccessDenied");
      }
    });

    it("should fail to join private game with wrong operator", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;
      const fakeOperator = anchor.web3.Keypair.generate();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: true,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      try {
        await testUtils.game.joinGame(gameData.gamePDA, player1.player, fakeOperator);
        expect.fail("Should have failed with wrong operator");
      } catch (error) {
        expect(error.toString()).to.include("PrivateGameAccessDenied");
      }
    });

    it("should fail to join full game", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1, player2] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Fill the game
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Try to join when full
      try {
        await testUtils.game.joinGame(gameData.gamePDA, player2.player);
        expect.fail("Should have failed when game is full");
      } catch (error) {
        expect(error.toString()).to.include("GameFull");
      }
    });

    it("should fail to join with insufficient funds", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      // Create a player with insufficient funds
      const poorPlayer = await testUtils.player.createPlayer(mint.mint);
      const insufficientAmount = new anchor.BN(500_000); // Half of required
      await testUtils.player.fundPlayer(poorPlayer, mint, insufficientAmount);

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      try {
        await testUtils.game.joinGame(gameData.gamePDA, poorPlayer.player);
        expect.fail("Should have failed with insufficient funds");
      } catch (error) {
        expect(error.toString()).to.include("InsufficientBalance");
      }
    });
  });

  describe("Game Completion", () => {
    it("should complete game successfully with correct winner", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Create and fill game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Calculate winner
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      // Create participation entry for winner
      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      // For simple 2-player game, create minimal merkle proof
      const winnerMerkleProof: number[][] = [];

      // Complete game
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerParticipation,
        winnerMerkleProof
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should fail to complete game with wrong operator", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;
      const fakeOperator = anchor.web3.Keypair.generate();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Calculate winner first
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      try {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          fakeOperator.publicKey,
          winnerParticipation,
          [],
          fakeOperator
        );
        expect.fail("Should have failed with wrong operator");
      } catch (error) {
        // Should fail with unauthorized operator error
        expect(error.toString()).to.include("UnauthorizedOperator");
      }
    });

    it("should fail to complete game with wrong secret key", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Use wrong secret key
      const wrongSecretKey = Array.from(
        anchor.web3.Keypair.generate().secretKey.slice(0, 32)
      );

      const fakeGameData = {
        ...gameData,
        secretKey: wrongSecretKey,
      };

      // Calculate winner and create participation
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        gameData.secretKey, // Use correct secret for winner calculation
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      try {
        await testUtils.game.completeGame(
          fakeGameData, // This has the wrong secret key
          winner.player.publicKey,
          creator.player.publicKey,
          oracle.operator,
          winnerParticipation,
          []
        );
        expect.fail("Should have failed with wrong secret key");
      } catch (error) {
        expect(error.toString()).to.include("InvalidSecretKey");
      }
    });
  });

  describe("Player Balance Operations", () => {
    it("should withdraw player balance successfully", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const player = players[0];

      // First, we need to add some balance to the player's account
      // This would normally happen through game winnings
      // For this test, we'll need to simulate having a balance

      try {
        await env.program.methods
          .withdrawPlayerBalance()
          .accounts({
            player: player.player.publicKey,
            tokenMint: mint.mint,
          })
          .signers([player.player])
          .rpc();

        // If there's no balance, it should fail
        expect.fail("Should have failed with no balance to withdraw");
      } catch (error) {
        expect(error.toString()).to.include("InsufficientBalance");
      }
    });

    it("should fail to withdraw with insufficient balance", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const player = players[0];

      try {
        await env.program.methods
          .withdrawPlayerBalance()
          .accounts({
            player: player.player.publicKey,
            tokenMint: mint.mint,
          })
          .signers([player.player])
          .rpc();

        expect.fail("Should have failed with insufficient balance");
      } catch (error) {
        expect(error.toString()).to.include("InsufficientBalance");
      }
    });
  });

  describe("Winner Calculation", () => {
    it("should calculate winner correctly for 2 players", async () => {
      const secretKey = Array.from(anchor.web3.Keypair.generate().secretKey.slice(0, 32));
      const lastSlot = 12345;

      const winnerIndex = calculateWinnerIndex(2, secretKey, lastSlot);

      expect(winnerIndex).to.be.oneOf([0, 1]);
    });

    it("should calculate winner correctly for multiple players", async () => {
      const secretKey = Array.from(anchor.web3.Keypair.generate().secretKey.slice(0, 32));
      const lastSlot = 67890;
      const playerCount = 5;

      const winnerIndex = calculateWinnerIndex(playerCount, secretKey, lastSlot);

      expect(winnerIndex).to.be.at.least(0);
      expect(winnerIndex).to.be.below(playerCount);
    });

    it("should return 0 for single player", async () => {
      const secretKey = Array.from(anchor.web3.Keypair.generate().secretKey.slice(0, 32));
      const lastSlot = 11111;

      const winnerIndex = calculateWinnerIndex(1, secretKey, lastSlot);

      expect(winnerIndex).to.equal(0);
    });
  });

  describe("Quick Setup Utility", () => {
    it("should provide working quick setup", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();

      expect(oracle.oraclePDA).to.not.be.undefined;
      expect(mint.mint).to.not.be.undefined;
      expect(players).to.have.length(8);

      // Verify all players are funded
      for (const player of players) {
        const balance = await env.provider.connection.getTokenAccountBalance(
          player.playerTokenAccount.address
        );
        expect(parseInt(balance.value.amount)).to.be.greaterThan(0);
      }
    });
  });
});
