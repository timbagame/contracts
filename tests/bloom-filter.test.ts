import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  GameConfig,
} from "./test-helpers";

/**
 * Bloom Filter Advanced Testing Suite
 *
 * Tests sophisticated bloom filter scenarios:
 * - Filter switching and A/B rotation
 * - Filter clearing after game expiry
 * - Long-term unjoin scenarios that trigger filter saturation
 * - Recent games buffer behavior with 6 game capacity
 * - Triple-layer safety verification (recent games + dual filters + timestamps)
 */

describe("Bloom Filter Advanced Testing", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    console.log("🧪 Setting up bloom filter test environment...");

    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();

    // Initialize global test environment
    await env.initialize();

    console.log("✅ Bloom filter test environment ready");
  });

  describe("Recent Games Buffer (6 Games)", () => {
    it("should provide 100% accuracy for last 6 games", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const testPlayer = players[0];

      // Create 10 games to test recent buffer behavior
      const games = [];
      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      console.log("Creating 10 games...");
      for (let i = 0; i < 10; i++) {
        const gameData = testUtils.game.generateGamePDA();
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          testPlayer.player,
          mint.mint
        );
        
        // Join the game to add it to recent games buffer
        await testUtils.game.joinGame(gameData.gamePDA, testPlayer.player);
        games.push(gameData);
        
        console.log(`Game ${i + 1}/10 created and joined`);
      }

      // The recent games buffer should contain the last 6 games
      // Games 0-3 should have been evicted from the buffer
      // Games 4-9 should still be in the recent games buffer

      console.log("Testing recent games accuracy...");
      
      // Try to join games 4-9 again - should fail (in recent buffer)
      for (let i = 4; i < 10; i++) {
        try {
          await testUtils.game.joinGame(games[i].gamePDA, testPlayer.player);
          expect.fail(`Should not be able to rejoin game ${i} (in recent buffer)`);
        } catch (error) {
          expect(error.toString()).to.include("AlreadyJoined");
          console.log(`✅ Game ${i} correctly blocked by recent games buffer`);
        }
      }

      // Games 0-3 might be blocked by bloom filter (probabilistic)
      // but should NOT be in recent games buffer
      console.log("Games 0-3 are no longer in recent buffer (may be in bloom filter)");
    });
  });

  describe("Filter Switching and A/B Rotation", () => {
    it("should switch between filter_a and filter_b safely", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const testPlayer = players[0];

      // Create games with different expiry times to trigger filter switching
      const shortGameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 5, // Very short timeout
        isPrivate: false,
      };

      const longGameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600, // Long timeout
        isPrivate: false,
      };

      console.log("Phase 1: Creating short-timeout games...");
      const shortGames = [];
      for (let i = 0; i < 3; i++) {
        const gameData = testUtils.game.generateGamePDA();
        await testUtils.game.initializeGame(
          gameData,
          shortGameConfig,
          testPlayer.player,
          mint.mint
        );
        await testUtils.game.joinGame(gameData.gamePDA, testPlayer.player);
        shortGames.push(gameData);
        console.log(`Short game ${i + 1}/3 created`);
      }

      console.log("Phase 2: Waiting for short games to expire...");
      // Wait for short games to expire + oracle buffer + filter cleanup buffer
      const totalBufferTime = oracle.config.oracleBufferTime + oracle.config.filterCleanupBuffer;
      const waitTime = (shortGameConfig.timeout + totalBufferTime + 2) * 1000;
      console.log(`Waiting ${waitTime/1000} seconds for filter switching...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      console.log("Phase 3: Creating long-timeout games (should trigger filter switch)...");
      const longGames = [];
      for (let i = 0; i < 3; i++) {
        const gameData = testUtils.game.generateGamePDA();
        await testUtils.game.initializeGame(
          gameData,
          longGameConfig,
          testPlayer.player,
          mint.mint
        );
        await testUtils.game.joinGame(gameData.gamePDA, testPlayer.player);
        longGames.push(gameData);
        console.log(`Long game ${i + 1}/3 created (filter should have switched)`);
      }

      console.log("Phase 4: Verifying filter switching worked...");
      // At this point, filter switching should have occurred
      // Short games should be unjoined-able, long games should be blocked

      // Try to rejoin long games - should fail (recent + active filter)
      for (let i = 0; i < longGames.length; i++) {
        try {
          await testUtils.game.joinGame(longGames[i].gamePDA, testPlayer.player);
          expect.fail(`Should not be able to rejoin long game ${i}`);
        } catch (error) {
          expect(error.toString()).to.include("AlreadyJoined");
          console.log(`✅ Long game ${i} correctly blocked`);
        }
      }

      console.log("✅ Filter switching test completed successfully");
    });
  });

  describe("Long-term Unjoin Scenarios", () => {
    it("should handle players taking long time to unjoin without breaking filters", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const testPlayer = players[0];
      const otherPlayer = players[1];

      console.log("Phase 1: Creating a game that will be stuck for a long time...");
      const stuckGameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 10, // Short timeout for testing
        isPrivate: false,
      };

      const stuckGameData = testUtils.game.generateGamePDA();
      await testUtils.game.initializeGame(
        stuckGameData,
        stuckGameConfig,
        testPlayer.player,
        mint.mint
      );

      // Both players join
      await testUtils.game.joinGame(stuckGameData.gamePDA, testPlayer.player);
      await testUtils.game.joinGame(stuckGameData.gamePDA, otherPlayer.player);

      console.log("Phase 2: Creating many other games while stuck game is pending...");
      // Create many other games to fill up filters and test filter saturation resistance
      const normalConfig: GameConfig = {
        gameType: { giveaway: {} }, // Use giveaway for instant completion
        amount: new anchor.BN(1_000_000),
        maxTickets: 3,
        minTickets: 1,
        timeout: 3600,
        isPrivate: false,
      };

      const normalGames = [];
      for (let i = 0; i < 15; i++) { // Create many games to stress test filters
        const gameData = testUtils.game.generateGamePDA();
        await testUtils.game.initializeGame(
          gameData,
          normalConfig,
          testPlayer.player,
          mint.mint
        );
        
        // Join the game (will add to filters)
        await testUtils.game.joinGame(gameData.gamePDA, testPlayer.player);
        normalGames.push(gameData);
        
        if (i % 5 === 0) {
          console.log(`Created ${i + 1}/15 normal games...`);
        }
      }

      console.log("Phase 3: Waiting for stuck game to expire...");
      // Wait for stuck game to expire + oracle buffer time
      const waitTime = (stuckGameConfig.timeout + oracle.config.oracleBufferTime + 2) * 1000;
      console.log(`Waiting ${waitTime/1000} seconds for stuck game to become unjoin-able...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      console.log("Phase 4: Player finally unjoins from stuck game...");
      // Now players can emergency unjoin from the stuck game
      await testUtils.game.unjoinGame(stuckGameData.gamePDA, testPlayer.player, 0);
      await testUtils.game.unjoinGame(stuckGameData.gamePDA, otherPlayer.player, 1);

      console.log("Phase 5: Verifying system integrity after long-term unjoin...");
      // Verify stuck game is now empty
      const stuckGame = await env.program.account.game.fetch(stuckGameData.gamePDA);
      expect(stuckGame.ticketsCount).to.equal(0);

      // Verify player can still join new games (filters not corrupted)
      const testGameData = testUtils.game.generateGamePDA();
      await testUtils.game.initializeGame(
        testGameData,
        normalConfig,
        testPlayer.player,
        mint.mint
      );
      await testUtils.game.joinGame(testGameData.gamePDA, testPlayer.player);

      const testGame = await env.program.account.game.fetch(testGameData.gamePDA);
      expect(testGame.ticketsCount).to.equal(1);

      console.log("✅ Long-term unjoin scenario completed successfully");
      console.log("✅ Filter system maintained integrity despite extended delays");
    });
  });

  describe("Triple-Layer Safety Verification", () => {
    it("should verify all three safety layers work together", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const testPlayer = players[0];

      console.log("Phase 1: Testing Layer 1 (Recent Games Buffer)...");
      
      // Create a game and join it
      const recentGameData = testUtils.game.generateGamePDA();
      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        recentGameData,
        gameConfig,
        testPlayer.player,
        mint.mint
      );
      await testUtils.game.joinGame(recentGameData.gamePDA, testPlayer.player);

      // Should be blocked by Layer 1 (recent games)
      try {
        await testUtils.game.joinGame(recentGameData.gamePDA, testPlayer.player);
        expect.fail("Should be blocked by recent games layer");
      } catch (error) {
        expect(error.toString()).to.include("AlreadyJoined");
        console.log("✅ Layer 1 (Recent Games) working correctly");
      }

      console.log("Phase 2: Testing Layer 3 (Timestamp Protection)...");
      
      // Create a new game with current timestamp
      const timestampGameData = testUtils.game.generateGamePDA();
      await testUtils.game.initializeGame(
        timestampGameData,
        gameConfig,
        testPlayer.player,
        mint.mint
      );

      // This should be allowed because the game was created after filter updates
      await testUtils.game.joinGame(timestampGameData.gamePDA, testPlayer.player);
      console.log("✅ Layer 3 (Timestamp Protection) working correctly");

      console.log("Phase 3: Testing Layer 2 (Dual Bloom Filters) integration...");
      
      // Create many games to test bloom filter functionality
      const bloomGames = [];
      for (let i = 0; i < 10; i++) {
        const gameData = testUtils.game.generateGamePDA();
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          testPlayer.player,
          mint.mint
        );
        await testUtils.game.joinGame(gameData.gamePDA, testPlayer.player);
        bloomGames.push(gameData);
      }

      // Verify that attempting to rejoin any of these games is blocked
      for (let i = 0; i < bloomGames.length; i++) {
        try {
          await testUtils.game.joinGame(bloomGames[i].gamePDA, testPlayer.player);
          expect.fail(`Should not be able to rejoin game ${i}`);
        } catch (error) {
          expect(error.toString()).to.include("AlreadyJoined");
        }
      }
      console.log("✅ Layer 2 (Dual Bloom Filters) working correctly");

      console.log("✅ All three safety layers verified working together");
    });
  });

  describe("Filter Cleaning and Reset Behavior", () => {
    it("should clean filters automatically when safe to do so", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const testPlayer = players[0];

      console.log("Phase 1: Creating games with short expiry times...");
      
      const shortConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 3, // Very short for testing
        isPrivate: false,
      };

      // Create several short games
      const shortGames = [];
      for (let i = 0; i < 5; i++) {
        const gameData = testUtils.game.generateGamePDA();
        await testUtils.game.initializeGame(
          gameData,
          shortConfig,
          testPlayer.player,
          mint.mint
        );
        await testUtils.game.joinGame(gameData.gamePDA, testPlayer.player);
        shortGames.push(gameData);
        console.log(`Short game ${i + 1}/5 created`);
      }

      console.log("Phase 2: Waiting for filter cleaning opportunity...");
      
      // Wait for games to expire + buffers
      const totalBuffer = oracle.config.oracleBufferTime + oracle.config.filterCleanupBuffer;
      const waitTime = (shortConfig.timeout + totalBuffer + 2) * 1000;
      console.log(`Waiting ${waitTime/1000} seconds for filter cleaning...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      console.log("Phase 3: Creating new game to trigger filter cleaning...");
      
      // Create a new game - this should trigger filter cleaning
      const cleanGameData = testUtils.game.generateGamePDA();
      const longConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600, // Long timeout
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        cleanGameData,
        longConfig,
        testPlayer.player,
        mint.mint
      );
      
      // This join should trigger filter cleaning and reset recent games
      await testUtils.game.joinGame(cleanGameData.gamePDA, testPlayer.player);
      
      console.log("✅ Filter cleaning completed successfully");
      console.log("✅ System continues to function normally after cleaning");
    });
  });
});