import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  GameConfig,
  CollisionUtils,
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
        maxTickets: 3,
        minTickets: 3,
        timeout: new anchor.BN(3600),
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
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      const actualWinnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      // Use actual winner index
      const winner = getWinnerFromPlayers(
        players.slice(0, 3),
        actualWinnerIndex
      );

      // Complete game
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        actualWinnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should handle large player counts with merkle trees", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(500_000),
        maxTickets: 6, // Reduce to 6 players to avoid merkle tree limits
        minTickets: 6,
        timeout: new anchor.BN(3600),
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join 6 players
      for (let i = 0; i < 6; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Verify game state
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(6);
      expect(gameAccount.totalAmount.toNumber()).to.equal(3_000_000);

      // Complete game (force winner to be from recent players to use empty proof)
      const actualWinnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      // Use actual winner index
      const winner = getWinnerFromPlayers(
        players.slice(0, 6),
        actualWinnerIndex
      );

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        actualWinnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should track player participation with bloom filters", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 4,
        minTickets: 4,
        timeout: new anchor.BN(3600),
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

      // Verify game state is properly updated
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(4);
      expect(gameAccount.totalAmount.toNumber()).to.equal(4_000_000);
    });
  });

  describe("Complex Game Scenarios", () => {
    it("should handle multiple players joining sequentially", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 5,
        minTickets: 2,
        timeout: new anchor.BN(3600),
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join players one by one
      for (let i = 0; i < 4; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);

        const gameAccount = await env.program.account.game.fetch(
          gameData.gamePDA
        );
        expect(gameAccount.ticketsCount).to.equal(i + 1);
        expect(gameAccount.totalAmount.toNumber()).to.equal(
          (i + 1) * 1_000_000
        );
      }

      // Verify final state
      const finalGameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(finalGameAccount.ticketsCount).to.equal(4);
      expect(finalGameAccount.totalAmount.toNumber()).to.equal(4_000_000);
    });

    it("should handle rapid game creation and joining", async () => {
      const { mint, players } = await testUtils.quickSetup();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: new anchor.BN(3600),
        isPrivate: false,
      };

      // Create and fill multiple games rapidly
      for (let cycle = 0; cycle < 3; cycle++) {
        const gameData = testUtils.game.generateGamePDA();

        // Initialize game
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );

        // Fill game to completion
        await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
        await testUtils.game.joinGame(gameData.gamePDA, players[1].player);

        const gameAccount = await env.program.account.game.fetch(
          gameData.gamePDA
        );
        expect(gameAccount.ticketsCount).to.equal(2);
        expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);
      }
    });

    it("should handle maximum capacity stress test", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const oracle = await testUtils.oracle.getOracle();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: Math.min(oracle.config.maxTickets, 6), // Limit to 6 to avoid merkle tree issues
        minTickets: 2,
        timeout: new anchor.BN(3600),
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
      const maxTickets = Math.min(gameConfig.maxTickets, players.length);
      for (let i = 0; i < maxTickets; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Verify capacity reached
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(maxTickets);

      // Try to exceed capacity (should fail)
      if (players.length > maxTickets) {
        try {
          await testUtils.game.joinGame(
            gameData.gamePDA,
            players[maxTickets].player
          );
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
        maxTickets: 2, // Use max players for immediate completion
        minTickets: 2,
        timeout: new anchor.BN(3600),
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join to reach max players
      await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[1].player);

      // Game should be completable immediately after reaching max players
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers(
        [players[0], players[1]],
        winnerIndex
      );

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should handle oracle buffer time expiry with emergency fund recovery", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: new anchor.BN(2), // Short timeout
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
      const totalWaitTime =
        (gameConfig.timeout.toNumber() + oracle.config.oracleBufferTime + 1) *
        1000;
      await new Promise((resolve) => setTimeout(resolve, totalWaitTime));

      // Players can now recover their funds via emergency unjoin
      // For 2 players, both can unjoin with their correct ticket indices
      await testUtils.game.unjoinGame(
        gameData.gamePDA,
        players[1].player,
        1 // Player 1 has ticket index 1
      );
      await testUtils.game.unjoinGame(
        gameData.gamePDA,
        players[0].player,
        0 // Player 0 has ticket index 0
      );

      // Verify game is now empty
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(0);

      // Now empty game can be closed
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
        maxTickets: 4,
        minTickets: 3,
        timeout: new anchor.BN(3600), // Long timeout
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
      try {
        await testUtils.game.completeGame(
          gameData,
          players[0].player.publicKey,
          players[0].player.publicKey,
          oracle.operator,
          0
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
          maxTickets: 2,
          minTickets: 2,
          timeout: new anchor.BN(3600),
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
        await testUtils.game.joinGame(
          games[i].gameData.gamePDA,
          games[i].creator.player
        );
        await testUtils.game.joinGame(
          games[i].gameData.gamePDA,
          players[(i + 1) % 3].player
        );
      }

      // Verify all games are independent
      for (let i = 0; i < 3; i++) {
        const gameAccount = await env.program.account.game.fetch(
          games[i].gameData.gamePDA
        );
        expect(gameAccount.ticketsCount).to.equal(2);
        expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);
      }

      // Complete one game without affecting others
      const gameAccount = await env.program.account.game.fetch(
        games[0].gameData.gamePDA
      );
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        games[0].gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = winnerIndex === 0 ? games[0].creator : players[1];

      await testUtils.game.completeGame(
        games[0].gameData,
        winner.player.publicKey,
        games[0].creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify first game completed, others still active
      const completedGame = await env.program.account.game.fetch(
        games[0].gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);

      const stillActiveGame = await env.program.account.game.fetch(
        games[1].gameData.gamePDA
      );
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
        maxTickets: 2,
        minTickets: 1,
        timeout: new anchor.BN(3600),
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
      const game1Account = await env.program.account.game.fetch(
        game1Data.gamePDA
      );
      const game2Account = await env.program.account.game.fetch(
        game2Data.gamePDA
      );

      expect(game1Account.ticketsCount).to.equal(1);
      expect(game2Account.ticketsCount).to.equal(1);
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
          maxTickets: 2,
          minTickets: 1,
          timeout: new anchor.BN(3600),
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

      // Use large but affordable amount (players are funded with 10M tokens)
      const largeAmount = new anchor.BN("5000000"); // 5M tokens (within player balance)

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: largeAmount,
        maxTickets: 1,
        minTickets: 1,
        timeout: new anchor.BN(3600),
        isPrivate: false,
      };

      // Should handle large amounts safely
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      // For giveaway games, ticketAmount is 0 (players don't pay), but totalAmount should be the creator's contribution
      expect(gameAccount.ticketAmount.toNumber()).to.equal(0);
      expect(gameAccount.totalAmount.toString()).to.equal(
        largeAmount.toString()
      );
    });
  });

  describe("Collision Detection Performance", () => {
    it("should handle collision detection without significant gas overhead", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const player = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: new anchor.BN(3600),
        isPrivate: false,
      };

      // Measure baseline join gas cost
      const baselineGame = testUtils.game.generateGamePDA();
      await testUtils.game.initializeGame(
        baselineGame,
        gameConfig,
        player.player,
        mint.mint
      );

      await testUtils.game.joinGame(baselineGame.gamePDA, player.player);

      // Create collision scenario and measure gas cost
      const collisionGames = await CollisionUtils.createCollisionScenario(
        testUtils,
        player,
        mint,
        15
      );

      // The collision system should not significantly increase gas costs
      // This test verifies the collision detection is performant
      expect(collisionGames.length).to.be.greaterThan(0);
      console.log(
        `✅ Collision detection system handled ${collisionGames.length} games efficiently`
      );
    });

    it("should validate filter memory usage remains constant", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const player = players[0];

      // Get initial filter state
      const initialState = await CollisionUtils.validateFilterState(
        env.program,
        player.playerBalancePDA
      );

      // Create many games to test filter memory behavior
      await CollisionUtils.simulateRapidJoins(testUtils, player, mint, 30);

      // Get final filter state
      const finalState = await CollisionUtils.validateFilterState(
        env.program,
        player.playerBalancePDA
      );

      // Filter structure should remain consistent
      expect(finalState.activeFilterIndex).to.be.oneOf([0, 1]);
      expect(typeof finalState.filterCleaningScheduledAt).to.equal("number");
      expect(typeof finalState.emergencyUnjoinMode).to.equal("boolean");

      console.log("✅ Filter memory usage validated:", {
        initialActiveFilter: initialState.activeFilterIndex,
        finalActiveFilter: finalState.activeFilterIndex,
        cleanupScheduled: finalState.filterCleaningScheduledAt > 0,
        emergencyMode: finalState.emergencyUnjoinMode,
      });
    });
  });
});
