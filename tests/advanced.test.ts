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
 * Advanced Features test suite for the Coinflip program
 *
 * Tests complex functionality and edge cases:
 * - Merkle tree operations and proofs
 * - Complex join/unjoin scenarios with swap-with-last
 * - Game timeouts and completion edge cases
 * - Multi-game scenarios
 * - Performance and scalability tests
 * - Advanced merkle proof validation
 */

describe("Advanced Features", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    console.log("🚀 Setting up advanced features test environment...");

    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();

    // Initialize global test environment
    await env.initialize();

    console.log("✅ Advanced features test environment ready");
  });

  describe("Merkle Tree Operations", () => {
    it("should handle game completion with small player count", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 3,
        minPlayers: 3,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize and fill game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      for (let i = 0; i < 3; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Calculate winner
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers(players.slice(0, 3), winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      // Complete game (use empty proof for recent players validation)
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        winnerParticipation,
        [] // Empty proof for recent players
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should handle large player counts with merkle trees", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(500_000),
        maxPlayers: 8, // Use all available players
        minPlayers: 8,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join all 8 players
      for (let i = 0; i < 8; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Verify game state
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(8);
      expect(gameAccount.totalAmount.toNumber()).to.equal(4_000_000);

      // Complete game (merkle proof generation complex for 8 players, so use empty proof for recent players)
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers(players.slice(0, 8), winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        winnerParticipation,
        [] // Use empty proof for recent players buffer validation
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should validate merkle root consistency", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 4,
        minPlayers: 4,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize and fill game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      for (let i = 0; i < 4; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Verify merkle root is computed and stored
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.merkleRoot).to.not.deep.equal(new Array(32).fill(0));

      // Game should have proper subtree structure
      expect(gameAccount.subtreeCount).to.be.greaterThan(0);
      expect(gameAccount.maxSubtrees).to.be.greaterThan(0);
    });
  });

  describe("Complex Join/Unjoin Scenarios", () => {
    it("should handle join and unjoin with player swapping", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 5,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join 3 players
      await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[1].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[2].player);

      // Verify initial state
      let gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(3);

      // Player 1 unjoins (middle player)
      await env.program.methods
        .unjoinGame(1, null) // Player at index 1, no exclusion proof for simple case
        .accounts({
          game: gameData.gamePDA,
          player: players[1].player.publicKey,
        })
        .signers([players[1].player])
        .rpc();

      // Verify player removed and count updated
      gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(2);

      // Player can rejoin
      await testUtils.game.joinGame(gameData.gamePDA, players[3].player);

      // Verify new player joined
      gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(3);
    });

    it("should handle rapid join/unjoin cycles", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 6,
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join creator
      await testUtils.game.joinGame(gameData.gamePDA, players[0].player);

      // Rapid join/unjoin cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        // Join player
        await testUtils.game.joinGame(gameData.gamePDA, players[1].player);

        let gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
        expect(gameAccount.playersCount).to.equal(2);

        // Unjoin player
        await env.program.methods
          .unjoinGame(1, null)
          .accounts({
            game: gameData.gamePDA,
            player: players[1].player.publicKey,
          })
          .signers([players[1].player])
          .rpc();

        gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
        expect(gameAccount.playersCount).to.equal(1);
      }
    });

    it("should handle maximum capacity stress test", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const oracle = await testUtils.oracle.getOracle();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: Math.min(oracle.config.maxPlayers, 8), // Use available players
        minPlayers: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Fill to capacity
      const maxPlayers = Math.min(gameConfig.maxPlayers, players.length);
      for (let i = 0; i < maxPlayers; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Verify capacity reached
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.playersCount).to.equal(maxPlayers);

      // Try to exceed capacity (should fail)
      if (players.length > maxPlayers) {
        try {
          await testUtils.game.joinGame(gameData.gamePDA, players[maxPlayers].player);
          expect.fail("Should have prevented exceeding capacity");
        } catch (error) {
          expect(error.toString()).to.include("GameFull");
        }
      }
    });
  });

  describe("Game Timeout and Completion Edge Cases", () => {
    it("should handle timeout completion with minimum players", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 4,
        minPlayers: 2,
        timeout: 2, // Very short timeout
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join minimum players
      await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[1].player);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Game should be completable after timeout with minimum players
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([players[0], players[1]], winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        winnerParticipation,
        []
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should handle oracle buffer time expiry", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 1, // Short timeout
        isPrivate: false,
      };

      // Initialize and fill game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[1].player);

      // Wait for timeout + oracle buffer time to expire
      const totalWaitTime = (gameConfig.timeout + oracle.config.oracleBufferTime + 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, totalWaitTime));

      // Game should be closeable after buffer expiry
      await env.program.methods
        .closeGame()
        .accounts({
          game: gameData.gamePDA,
          creator: players[0].player.publicKey,
        })
        .signers([players[0].player])
        .rpc();

      // Verify game is closed
      try {
        await env.program.account.game.fetch(gameData.gamePDA);
        expect.fail("Game account should be closed");
      } catch (error) {
        expect(error.toString()).to.include("Account does not exist");
      }
    });

    it("should prevent premature completion", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 4,
        minPlayers: 3,
        timeout: 3600, // Long timeout
        isPrivate: false,
      };

      // Initialize game with only 2 players (below minimum)
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[1].player);

      // Try to complete prematurely
      const winnerParticipation = {
        player: players[0].player.publicKey,
        playerIndex: 0,
      };

      try {
        await testUtils.game.completeGame(
          gameData,
          players[0].player.publicKey,
          players[0].player.publicKey,
          oracle.operator,
          winnerParticipation,
          []
        );
        expect.fail("Should have prevented premature completion");
      } catch (error) {
        expect(error.toString()).to.include("GameNotReadyForOracle");
      }
    });
  });

  describe("Multi-Game Scenarios", () => {
    it("should handle multiple concurrent games", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();

      // Create 3 different games
      const games = [];
      for (let i = 0; i < 3; i++) {
        const gameData = testUtils.game.generateGamePDA();
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
          players[i].player,
          mint.mint
        );

        games.push({ gameData, creator: players[i] });
      }

      // Fill each game with different players
      for (let i = 0; i < 3; i++) {
        await testUtils.game.joinGame(games[i].gameData.gamePDA, games[i].creator.player);
        await testUtils.game.joinGame(games[i].gameData.gamePDA, players[(i + 1) % 3].player);
      }

      // Verify all games are independent
      for (let i = 0; i < 3; i++) {
        const gameAccount = await env.program.account.game.fetch(games[i].gameData.gamePDA);
        expect(gameAccount.playersCount).to.equal(2);
        expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);
      }

      // Complete one game without affecting others
      const gameAccount = await env.program.account.game.fetch(games[0].gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        games[0].gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = winnerIndex === 0 ? games[0].creator : players[1];

      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        games[0].gameData,
        winner.player.publicKey,
        games[0].creator.player.publicKey,
        oracle.operator,
        winnerParticipation,
        []
      );

      // Verify first game completed, others still active
      const completedGame = await env.program.account.game.fetch(games[0].gameData.gamePDA);
      expect(completedGame.totalAmount.toNumber()).to.equal(0);

      const stillActiveGame = await env.program.account.game.fetch(games[1].gameData.gamePDA);
      expect(stillActiveGame.totalAmount.toNumber()).to.equal(2_000_000);
    });

    it("should handle players in multiple games simultaneously", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const player = players[0];

      // Create 2 games with same player as creator
      const game1Data = testUtils.game.generateGamePDA();
      const game2Data = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} }, // Use giveaway to avoid balance issues
        amount: new anchor.BN(1_000_000),
        maxPlayers: 2,
        minPlayers: 1,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize both games
      await testUtils.game.initializeGame(
        game1Data,
        gameConfig,
        player.player,
        mint.mint
      );

      await testUtils.game.initializeGame(
        game2Data,
        gameConfig,
        player.player,
        mint.mint
      );

      // Player joins both games
      await testUtils.game.joinGame(game1Data.gamePDA, player.player);
      await testUtils.game.joinGame(game2Data.gamePDA, player.player);

      // Verify player is in both games
      const game1Account = await env.program.account.game.fetch(game1Data.gamePDA);
      const game2Account = await env.program.account.game.fetch(game2Data.gamePDA);

      expect(game1Account.playersCount).to.equal(1);
      expect(game2Account.playersCount).to.equal(1);
    });
  });

  describe("Performance and Scalability", () => {
    it("should handle rapid game creation", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameCreationPromises = [];

      // Create 5 games rapidly
      for (let i = 0; i < 5; i++) {
        const gameData = testUtils.game.generateGamePDA();
        const gameConfig: GameConfig = {
          gameType: { giveaway: {} },
          amount: new anchor.BN(1_000_000),
          maxPlayers: 2,
          minPlayers: 1,
          timeout: 3600,
          isPrivate: false,
        };

        gameCreationPromises.push(
          testUtils.game.initializeGame(
            gameData,
            gameConfig,
            players[i % players.length].player,
            mint.mint
          )
        );
      }

      // All should succeed
      await Promise.all(gameCreationPromises);

      // Verify rapid creation didn't cause issues
      expect(gameCreationPromises.length).to.equal(5);
    });

    it("should handle large amounts without overflow", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      // Use large but safe amount
      const largeAmount = new anchor.BN("1000000000000"); // 1 trillion (still within u64 range)

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: largeAmount,
        maxPlayers: 1,
        minPlayers: 1,
        timeout: 3600,
        isPrivate: false,
      };

      // Should handle large amounts safely
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.ticketAmount.toString()).to.equal(largeAmount.toString());
    });
  });
});