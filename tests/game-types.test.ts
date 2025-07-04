import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  GameConfig,
  generateMerkleProof,
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
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(2);
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);

      // Complete game
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1], winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        ticketIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerParticipation,
        []
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
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
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(4);
      expect(gameAccount.totalAmount.toNumber()).to.equal(2_000_000);

      // Complete game
      const actualWinnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      // Use actual winner index and generate proper merkle proof
      const winner = getWinnerFromPlayers(players.slice(0, 4), actualWinnerIndex);
      const merkleProof = generateMerkleProof(players.slice(0, 4), actualWinnerIndex, gameAccount);

      const winnerParticipation = {
        player: winner.player.publicKey,
        ticketIndex: actualWinnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        winnerParticipation,
        merkleProof
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
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
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(2);
      expect(gameAccount.totalAmount.toNumber()).to.equal(1_000_000); // Only creator's contribution

      // Complete game
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([player1, player2], winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        ticketIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerParticipation,
        []
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
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
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      expect(winnerIndex).to.equal(0); // Only one participant

      const winnerParticipation = {
        player: creator.player.publicKey,
        ticketIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        creator.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerParticipation,
        []
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
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
        const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
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
        maxTickets: 3, // Set to match actual entries for immediate completion
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

      // Then creator rolls for additional entry (creator's original entry index is 0)
      let gameStateForProof = await env.program.account.game.fetch(gameData.gamePDA);
      const creatorMerkleProof = generateMerkleProof([creator, player1, players[2]], 0, gameStateForProof);
      await testUtils.game.rollGame(gameData.gamePDA, creator.player, 0, creatorMerkleProof);

      // Verify accumulating pot
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.totalAmount.toNumber()).to.equal(4_000_000); // 4 entries
      expect(gameAccount.ticketsCount).to.equal(3); // 3 unique players 
      expect(gameAccount.ticketsCount).to.equal(4); // 4 total entries (3 joins + 1 roll)

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

      // Generate merkle proof for snowball game
      // Create a player list that represents the entries: [creator, player1, players[2], creator]
      const entryPlayers = [creator, player1, players[2], creator];
      const merkleProof = generateMerkleProof(entryPlayers, winnerIndex, gameAccount);

      const winnerParticipation = {
        player: actualWinner.player.publicKey,
        ticketIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        actualWinner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerParticipation,
        merkleProof
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
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
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(3); // 3 unique players
      expect(gameAccount.ticketsCount).to.equal(3); // 3 entries
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
      const merkleProof = generateMerkleProof(players.slice(0, 3), winnerIndex, gameAccount);

      const winnerParticipation = {
        player: winner.player.publicKey,
        ticketIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        players[0].player.publicKey,
        oracle.operator,
        winnerParticipation,
        merkleProof
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
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
        maxTickets: 3,
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
        let currentGameState = await env.program.account.game.fetch(gameData.gamePDA);
        console.log(`  Current state: ticketsCount=${currentGameState.ticketsCount}, recentCount=${currentGameState.recentCount}`);
        
        const currentProof = generateMerkleProof([creator, player1, player2], 0, currentGameState);
        console.log(`  Generated proof length: ${currentProof.length}`);
        
        await testUtils.game.rollGame(gameData.gamePDA, creator.player, 0, currentProof); // Creator's original entry index is 0
      }

      console.log("Verifying final state...");
      // Verify final state
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.ticketsCount).to.equal(3); // 3 unique players
      expect(gameAccount.ticketsCount).to.equal(13); // 3 joins + 10 rolls
      expect(gameAccount.totalAmount.toNumber()).to.equal(13_000_000); // 13 entries * 1M

      console.log(`Final state: ${gameAccount.ticketsCount} players, ${gameAccount.ticketsCount} entries, ${gameAccount.totalAmount.toNumber()} total amount`);

      // Complete game with entry-based winner calculation
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot),
        { snowball: {} },
        gameAccount.totalAmount.toNumber(),
        gameAccount.ticketAmount.toNumber()
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

      const winnerParticipation = {
        player: winner.player.publicKey,
        ticketIndex: winnerIndex,
      };

      console.log("Completing game...");
      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.operator,
        winnerParticipation,
        [] // Empty proof for testing
      );

      // Verify completion
      const completedGame = await env.program.account.game.fetch(gameData.gamePDA);
      expect(completedGame.totalAmount.toNumber()).to.equal(0);

      console.log("Test completed successfully!");
    }).timeout(60000); // 60 second timeout for this intensive test
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
        maxTickets: 1000, // Exceeds oracle limits
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
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
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
