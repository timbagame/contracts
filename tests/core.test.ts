import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  coinflipGameConfig,
  giveawayGameConfig,
  expectAnchorError,
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
      expect(oracle.operator.equals(oracle.operatorKeypair.publicKey)).to.be
        .true;
      expect(oracle.config.feePercentage).to.equal(1);
      expect(oracle.config.maxTickets).to.equal(50000);
    });

    it("should return existing oracle configuration", async () => {
      const customConfig = {
        feePercentage: 2,
        maxTickets: 50,
        maxTimeout: 1800,
      };

      // Since oracle already exists, this should return the existing configuration
      const oracle = await testUtils.oracle.createOracle(customConfig);

      // Should return the default configuration from the first initialization
      expect(oracle.config.feePercentage).to.equal(1);
      expect(oracle.config.maxTickets).to.equal(50000);
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

      await testUtils.mint.mintTokensToAccount(
        mint,
        player.playerTokenAccount.address,
        amount
      );

      const balance = await env.provider.connection.getTokenAccountBalance(
        player.playerTokenAccount.address
      );
      expect(balance.value.amount).to.equal(amount.toString());
    });
  });

  describe("Player Management", () => {
    it("should create player pool and fund players", async () => {
      const mint = await testUtils.mint.createMint();
      const players = await testUtils.player.createPlayerPool(3, mint.mint);
      for (const p of players) {
        await testUtils.player.fundPlayer(p, mint, new anchor.BN(1_000_000));
        const balance = await env.provider.connection.getTokenAccountBalance(
          p.playerTokenAccount.address
        );
        expect(parseInt(balance.value.amount)).to.be.greaterThan(0);
      }
    });
  });

  describe("Game Initialization", () => {
    it("should initialize coinflip game with valid parameters", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const creator = players[0];

      const gameConfig = coinflipGameConfig();

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      expect(gameAccount.creator.equals(creator.player.publicKey)).to.be.true;
      expect(gameAccount.ticketAmount.toNumber()).to.equal(1_000_000);
      expect(gameAccount.maxTickets).to.equal(2);
      expect(gameAccount.minTickets).to.equal(2);
      expect(gameAccount.ticketsCount).to.equal(0);
    });

    it("should fail to initialize game with invalid parameters", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const creator = players[0];

      const invalidConfig = coinflipGameConfig({
        maxTickets: 1, // Invalid: coinflip needs at least 2 players
        minTickets: 2, // Invalid: min > max
      });

      await expectAnchorError(
        testUtils.game.createGame(invalidConfig, creator.player, mint.mint),
        "InvalidTicketsCount",
        {
          fallbackSubstring: "InvalidTicketsCount",
          message: "Should have failed with invalid parameters",
        }
      );
    });

    it("should initialize giveaway game successfully", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const creator = players[0];

      const gameConfig = giveawayGameConfig();

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      expect(gameAccount.gameType.giveaway).to.not.be.undefined;
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000); // Giveaway uses totalAmount
      expect(gameAccount.ticketAmount.toNumber()).to.equal(0); // Giveaway sets ticketAmount to 0
      expect(gameAccount.maxTickets).to.equal(5);
      expect(gameAccount.minTickets).to.equal(1);
    });
  });

  describe("Player Join Operations", () => {
    it("should allow players to join public game", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const [creator, player1] = players;

      const gameConfig = coinflipGameConfig();

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      // Creator joins
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      let gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(1);

      // Second player joins
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(2);
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);
    });

    it("should allow players to join private game with operator", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const [creator, player1] = players;

      const gameConfig = coinflipGameConfig({
        isPrivate: true, // Private game
      });

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      // Players join with oracle operator
      await testUtils.game.joinGame(
        gameData.gamePDA,
        creator.player,
        oracle.operatorKeypair
      );
      await testUtils.game.joinGame(
        gameData.gamePDA,
        player1.player,
        oracle.operatorKeypair
      );

      const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(2);
    });

    it("should fail to join private game without operator", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const [creator, player1] = players;

      const gameConfig = coinflipGameConfig({ isPrivate: true });

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      await expectAnchorError(
        testUtils.game.joinGame(gameData.gamePDA, player1.player),
        "PrivateGameAccessDenied",
        {
          fallbackSubstring: "PrivateGameAccessDenied",
          message: "Should have failed without operator",
        }
      );
    });

    it("should fail to join private game with wrong operator", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const [creator, player1] = players;
      const fakeOperator = anchor.web3.Keypair.generate();

      const gameConfig = coinflipGameConfig({ isPrivate: true });

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      await expectAnchorError(
        testUtils.game.joinGame(
          gameData.gamePDA,
          player1.player,
          fakeOperator
        ),
        "PrivateGameAccessDenied",
        {
          fallbackSubstring: "PrivateGameAccessDenied",
          message: "Should have failed with wrong operator",
        }
      );
    });

    it("should fail to join full game", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const [creator, player1, player2] = players;

      const gameConfig = coinflipGameConfig();

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      // Fill the game
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Try to join when full
      await expectAnchorError(
        testUtils.game.joinGame(gameData.gamePDA, player2.player),
        "GameFull",
        {
          fallbackSubstring: "GameFull",
          message: "Should have failed when game is full",
        }
      );
    });

    it("should fail to join with insufficient funds", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const creator = players[0];

      // Create a player with insufficient funds
      const poorPlayer = await testUtils.player.createPlayer(mint.mint);
      const insufficientAmount = new anchor.BN(500_000); // Half of required
      await testUtils.player.fundPlayer(poorPlayer, mint, insufficientAmount);

      const gameConfig = coinflipGameConfig();

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );

      await expectAnchorError(
        testUtils.game.joinGame(gameData.gamePDA, poorPlayer.player),
        "InsufficientBalance",
        {
          fallbackSubstring: "InsufficientBalance",
          message: "Should have failed with insufficient funds",
        }
      );
    });
  });

  describe("Game Completion", () => {
    it("should complete game successfully with correct winner", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const [creator, player1] = players;

      const gameConfig = coinflipGameConfig();

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );
      // Fill game
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Calculate winner
      const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      // Complete game with winner index
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify completion by checking winner token balance increase & that account is closed
      // Game account uses `close = creator` in CompleteGame accounts, so fetching now should fail
      const winnerBalance =
        await env.provider.connection.getTokenAccountBalance(
          winner.playerTokenAccount.address
        );
      expect(parseInt(winnerBalance.value.amount)).to.be.greaterThan(
        100_000_000
      ); // initial 100m + winnings
      await expectAnchorError(
        testUtils.game.fetchGame(gameData.gamePDA),
        "AccountDoesNotExist",
        {
          fallbackSubstring: "Account does not exist",
          message: "Expected game account to be closed after completion",
        }
      );
    });

    it("should fail to complete game with wrong operator", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const [creator, player1] = players;
      const fakeOperator = anchor.web3.Keypair.generate();

      const gameConfig = coinflipGameConfig();

      const gameData = await testUtils.game.createGame(
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Calculate winner first
      const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      await expectAnchorError(
        testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          fakeOperator.publicKey,
          winnerIndex,
          fakeOperator
        ),
        "UnauthorizedOperator",
        {
          fallbackSubstring: "UnauthorizedOperator",
          message: "Should have failed with wrong operator",
        }
      );
    });

    it("should fail to complete game with wrong secret key", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const [creator, player1] = players;

      const gameConfig = coinflipGameConfig();

      const gameData = await testUtils.game.createGame(
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
      const gameAccount = await testUtils.game.fetchGame(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey, // Use correct secret for winner calculation
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      await expectAnchorError(
        testUtils.game.completeGame(
          fakeGameData, // This has the wrong secret key
          winner.player.publicKey,
          creator.player.publicKey,
          oracle.operator,
          winnerIndex
        ),
        "InvalidSecretKey",
        {
          fallbackSubstring: "InvalidSecretKey",
          message: "Should have failed with wrong secret key",
        }
      );
    });
  });

  describe("Winner Calculation", () => {
    it("should calculate winner correctly for 2 players", async () => {
      const secretKey = Array.from(
        anchor.web3.Keypair.generate().secretKey.slice(0, 32)
      );
      const lastSlot = 12345;

      const winnerIndex = calculateWinnerIndex(2, secretKey, lastSlot);

      expect(winnerIndex).to.be.oneOf([0, 1]);
    });

    it("should calculate winner correctly for multiple players", async () => {
      const secretKey = Array.from(
        anchor.web3.Keypair.generate().secretKey.slice(0, 32)
      );
      const lastSlot = 67890;
      const playerCount = 5;

      const winnerIndex = calculateWinnerIndex(
        playerCount,
        secretKey,
        lastSlot
      );

      expect(winnerIndex).to.be.at.least(0);
      expect(winnerIndex).to.be.below(playerCount);
    });

    it("should return 0 for single player", async () => {
      const secretKey = Array.from(
        anchor.web3.Keypair.generate().secretKey.slice(0, 32)
      );
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
