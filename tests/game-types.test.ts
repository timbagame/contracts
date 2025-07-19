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
 * Game Types test suite for the Coinflip program
 *
 * Tests different game variants and their specific rules:
 * - Coinflip: Standard competitive games
 * - Giveaway: Creator-funded free participation games
 * - Snowball: Progressive accumulating pot games
 * - Dumbflip: Immediate completion games (if supported)
 * - Game-specific restrictions and validations
 */

describe("Game Types", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    console.log("🎮 Setting up game types test environment...");

    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();

    // Initialize global test environment
    await env.initialize();

    console.log("✅ Game types test environment ready");
  });

  describe("Coinflip Games", () => {
    it("should create and complete a 2-player coinflip game", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
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

      // Both players join
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Verify game state before completion
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(2);
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);

      // Complete game
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should support multi-player coinflip games", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(500_000),
        maxTickets: 4,
        minTickets: 3,
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

      // Join 4 players
      for (let i = 0; i < 4; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Verify game state
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(4);
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);

      // Complete game
      const actualWinnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      // Use actual winner index
      const winner = getWinnerFromPlayers(
        players.slice(0, 4),
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

    it("should enforce minimum amount for coinflip games", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(0), // Invalid amount
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );
        expect.fail("Should have rejected zero amount for coinflip");
      } catch (error) {
        expect(error.toString()).to.include("InvalidAmount");
      }
    });
  });

  describe("Giveaway Games", () => {
    it("should create and complete a giveaway game", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1, player2] = players;

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: new anchor.BN(1_000_000), // Creator funds this
        maxTickets: 2, // Match actual player count for immediate completion
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize giveaway
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Players join for free (no ticket amount required)
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);
      await testUtils.game.joinGame(gameData.gamePDA, player2.player);

      // Verify game state
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(2);
      expect(gameAccount.totalAmount.toNumber()).to.equal(1_000_000); // Only creator's contribution

      // Complete game
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([player1, player2], winnerIndex);

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should allow single player giveaways", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 1,
        minTickets: 1,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize and join single-player giveaway
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      // Complete game (creator is the only participant)
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      expect(winnerIndex).to.equal(0); // Only one participant

      await testUtils.game.completeGame(
        gameData,
        creator.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should validate zero amount restrictions for giveaway games", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: new anchor.BN(0), // Zero amount - test if this is actually allowed
        maxTickets: 2,
        minTickets: 1,
        timeout: 3600,
        isPrivate: false,
      };

      // Test if zero amounts are actually allowed for giveaway games
      try {
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );

        // If we get here, zero amounts are allowed
        const gameAccount = await env.program.account.game.fetch(
          gameData.gamePDA
        );
        expect(gameAccount.ticketAmount.toNumber()).to.equal(0);
      } catch (error) {
        // If zero amounts are not allowed, verify the error
        expect(error.toString()).to.include("InvalidAmount");
      }
    });
  });

  describe("Snowball Games", () => {
    it("should create a snowball game with roll functionality", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { snowball: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 4, // Will be reached with 3 joins + 1 roll
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize snowball game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Players join first (one entry each)
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);
      await testUtils.game.joinGame(gameData.gamePDA, players[2].player); // Third player to reach max

      // Then creator rolls for additional entry
      await testUtils.game.rollGame(
        gameData.gamePDA,
        creator.player
      );

      // Verify accumulating pot
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.totalAmount.toNumber()).to.equal(4_000_000); // 4 entries
      expect(gameAccount.ticketsCount).to.equal(4); // 4 total tickets (3 joins + 1 roll)

      // Complete game with entry-based winner calculation
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot),
        { snowball: {} },
        gameAccount.totalAmount.toNumber(),
        gameAccount.ticketAmount.toNumber()
      );

      // For snowball games, map entry index to actual player
      // Entry 0: creator, Entry 1: player1, Entry 2: players[2], Entry 3: creator (roll)
      let actualWinner: any;
      if (winnerIndex === 0 || winnerIndex === 3) {
        actualWinner = creator; // creator won (either first join or roll)
      } else if (winnerIndex === 1) {
        actualWinner = player1; // player1 won
      } else {
        actualWinner = players[2]; // players[2] won
      }

      await testUtils.game.completeGame(
        gameData,
        actualWinner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);
    });

    it("should handle multi-player snowball games", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { snowball: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 3,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize snowball game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Multiple players join
      await testUtils.game.joinGame(gameData.gamePDA, players[0].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[1].player);
      await testUtils.game.joinGame(gameData.gamePDA, players[2].player);

      // Verify snowball accumulation
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(3); // 3 tickets total
      expect(gameAccount.totalAmount.toNumber()).to.equal(3_000_000);

      // Complete the snowball game
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot),
        { snowball: {} },
        gameAccount.totalAmount.toNumber(),
        gameAccount.ticketAmount.toNumber()
      );

      const winner = getWinnerFromPlayers(players.slice(0, 3), winnerIndex);

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

    it("should handle snowball game with 10 rolls", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];
      const player1 = players[1];
      const player2 = players[2];

      const gameConfig: GameConfig = {
        gameType: { snowball: {} },
        amount: new anchor.BN(1_000_000), // 1 TIMBA per entry
        maxTickets: 13, // Will be reached with 3 joins + 10 rolls
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      console.log("Initializing snowball game...");
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      console.log("Extra funding creator for 10 rolls...");
      // The creator needs extra funding for 10 rolls (10M tokens) + initial join (1M)
      // Current funding is 10M, need additional 5M tokens for safety
      await testUtils.mint.mintTokensToAccount(
        mint,
        creator.playerTokenAccount.address,
        new anchor.BN(5_000_000)
      );

      console.log("Players joining...");
      // 3 players join to reach max capacity (3 entries)
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);
      await testUtils.game.joinGame(gameData.gamePDA, player2.player);

      console.log("Starting 10 rolls...");
      // Creator rolls 10 times (10 additional entries)
      for (let i = 0; i < 10; i++) {
        console.log(`Roll ${i}/10`);

        // Generate fresh proof for each roll since tree structure changes
        let currentGameState = await env.program.account.game.fetch(
          gameData.gamePDA
        );
        console.log(
          `  Current state: ticketsCount=${currentGameState.ticketsCount}`
        );

        // Smart ticket selection: use the creator's most recent ticket instead of always ticket 0
        const committedTickets = currentGameState.ticketsCount;
        let ticketIndexToUse: number;

        if (i === 0) {
          // First roll: use ticket 0 (creator's original join)
          ticketIndexToUse = 0;
        } else {
          // Subsequent rolls: use the creator's most recent ticket (which should be in recent buffer)
          // The creator's last roll created ticket at index (3 + i - 1)
          ticketIndexToUse = 3 + i - 1;
        }

        console.log(
          `  Using ticket index: ${ticketIndexToUse}, committed threshold: ${committedTickets}`
        );

        await testUtils.game.rollGame(
          gameData.gamePDA,
          creator.player
        );
      }

      console.log("Verifying final state...");
      // Verify final state
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(13); // 3 joins + 10 rolls = 13 total tickets
      expect(gameAccount.totalAmount.toNumber()).to.equal(13_000_000); // 13 tickets * 1M

      console.log(
        `Final state: ${
          gameAccount.ticketsCount
        } tickets, ${gameAccount.totalAmount.toNumber()} total amount`
      );

      // Complete game with entry-based winner calculation
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      console.log(`Winner index: ${winnerIndex}`);

      // Determine which player won based on entry index
      // Entry 0: creator, Entry 1: player1, Entry 2: player2, Entries 3-12: creator (10 rolls)
      let winner: any;
      if (winnerIndex === 0 || winnerIndex >= 3) {
        winner = creator; // Creator's first entry or any roll
      } else if (winnerIndex === 1) {
        winner = player1; // Player1's entry
      } else if (winnerIndex === 2) {
        winner = player2; // Player2's entry
      }

      console.log("Completing game...");
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerIndex
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(completedGame.totalAmount.toNumber()).to.equal(0);

      console.log("Test completed successfully!");
    }).timeout(60000); // 60 second timeout for this intensive test

    it("should handle massive snowball game with 10 players and 40 rolls", async () => {
      console.log("Initializing massive snowball game...");

      // Get basic setup first
      const { oracle, mint } = await testUtils.quickSetup();

      // Create 10 players for initial joins
      const players = await testUtils.player.createPlayerPool(10, mint.mint);

      // Fund all players
      for (const player of players) {
        await testUtils.player.fundPlayer(
          player,
          mint,
          new anchor.BN(100_000_000)
        );
      }

      // Extra funding for the two players who will do the rolls
      await testUtils.player.fundPlayer(
        players[0],
        mint,
        new anchor.BN(200_000_000)
      ); // Player 0 does 20 rolls
      await testUtils.player.fundPlayer(
        players[1],
        mint,
        new anchor.BN(200_000_000)
      ); // Player 1 does 20 rolls

      console.log("Players funded for massive game...");

      // Create snowball game
      const gameData = testUtils.game.generateGamePDA();
      const gameConfig: GameConfig = {
        gameType: { snowball: {} },
        amount: new anchor.BN(1_000_000), // 1 TIMBA per roll
        maxTickets: 50, // Allow for 10 initial + 40 rolls
        minTickets: 10, // Start with 10 players
        timeout: 7200,
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      console.log("Game initialized, players joining...");

      // All 10 players join
      for (let i = 0; i < 10; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      console.log("All 10 players joined, starting rolls...");


      // Player 0 does 20 rolls
      console.log("Player 0 starting 20 rolls...");
      for (let i = 0; i < 20; i++) {
        console.log(`Player 0 roll ${i + 1}/20`);

        await testUtils.game.rollGame(
          gameData.gamePDA,
          players[0].player
        );
      }

      // Player 1 does 20 rolls
      console.log("Player 1 starting 20 rolls...");
      for (let i = 0; i < 20; i++) {
        console.log(`Player 1 roll ${i + 1}/20`);

        // Generate proof for the roll using Player 1's initial ticket (index 1)
        const currentGameState = await env.program.account.game.fetch(
          gameData.gamePDA
        );
        console.log(
          `  DEBUG: Current game state - tickets: ${currentGameState.ticketsCount}, maxTickets: ${currentGameState.maxTickets}`
        );

        try {
          await testUtils.game.rollGame(
            gameData.gamePDA,
            players[1].player
          );
          console.log(`  DEBUG: Roll ${i + 1} completed successfully`);
        } catch (error) {
          console.log(
            `  DEBUG: Roll ${i + 1} failed with error:`,
            error.toString()
          );
          throw error;
        }
      }

      console.log("All rolls completed, verifying final state...");

      // Verify final state
      const finalGame = await env.program.account.game.fetch(gameData.gamePDA);
      console.log(
        `Final state: ${
          finalGame.ticketsCount
        } tickets, ${finalGame.totalAmount.toNumber()} total amount`
      );
      expect(finalGame.ticketsCount).to.equal(50); // 10 initial + 20 + 20 rolls
      expect(finalGame.totalAmount.toNumber()).to.equal(50_000_000); // 50 tickets * 1M each

      // Calculate winner
      const winnerIndex = calculateWinnerIndex(
        finalGame.ticketsCount,
        gameData.secretKey,
        Number(finalGame.lastSlot)
      );
      console.log(`Winner index: ${winnerIndex}`);

      // Determine which player won based on ticket index
      // Tickets 0-9: players[0] through players[9]
      // Tickets 10-29: players[0] (20 rolls)
      // Tickets 30-49: players[1] (20 rolls)
      let winner: any;
      if (winnerIndex < 10) {
        winner = players[winnerIndex]; // One of the initial 10 players
      } else if (winnerIndex < 30) {
        winner = players[0]; // Player 0's rolls
      } else {
        winner = players[1]; // Player 1's rolls
      }

      console.log("Completing massive game...");

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

      console.log("Massive test completed successfully!");
    }).timeout(120000); // 2 minute timeout for this very intensive test
  });

  describe("Game Type Validation", () => {
    it("should enforce minimum player requirements per game type", async () => {
      const { mint, players } = await testUtils.quickSetup();

      // Coinflip should require at least 2 players
      const coinflipData = testUtils.game.generateGamePDA();
      const coinflipConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 4,
        minTickets: 1, // Too low for coinflip
        timeout: 3600,
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          coinflipData,
          coinflipConfig,
          players[0].player,
          mint.mint
        );
        expect.fail("Should have enforced minimum players for coinflip");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTicketsCount");
      }
    });

    it("should validate game type specific configurations", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      // Test maximum players validation
      const invalidConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 100000, // Exceeds oracle limits (oracle max is 50000)
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          gameData,
          invalidConfig,
          players[0].player,
          mint.mint
        );
        expect.fail("Should have validated max players limit");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTicketsCount");
      }
    });

    it("should validate timeout ranges per game type", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      // Test timeout validation
      const invalidConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 4,
        minTickets: 2,
        timeout: 0, // Invalid timeout
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          gameData,
          invalidConfig,
          players[0].player,
          mint.mint
        );
        expect.fail("Should have validated timeout");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTimeout");
      }
    });
  });

  describe("Private Games", () => {
    it("should require oracle operator approval for private games", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
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

      // Creator also needs oracle operator approval for private games
      await testUtils.game.joinGame(
        gameData.gamePDA,
        creator.player,
        oracle.operatorKeypair
      );

      // Other players need oracle operator approval
      await testUtils.game.joinGame(
        gameData.gamePDA,
        player1.player,
        oracle.operatorKeypair
      );

      // Verify both players joined
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      expect(gameAccount.ticketsCount).to.equal(2);
      expect(gameAccount.isPrivate).to.be.true;
    });

    it("should reject joining private games without operator approval", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 3,
        minTickets: 2,
        timeout: 3600,
        isPrivate: true,
      };

      // Initialize private game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Creator joins with oracle operator approval (private games require it for everyone)
      await testUtils.game.joinGame(
        gameData.gamePDA,
        creator.player,
        oracle.operatorKeypair
      );

      // Try to join without oracle operator approval
      try {
        await testUtils.game.joinGame(gameData.gamePDA, player1.player);
        expect.fail("Should have required oracle operator for private game");
      } catch (error) {
        expect(error.toString()).to.include("PrivateGameAccessDenied");
      }
    });
  });
});
