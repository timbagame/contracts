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
 * Security test suite for the Coinflip game
 *
 * Tests security-critical scenarios:
 * - Replay attack prevention
 * - Unauthorized access attempts
 * - Game state manipulation attempts
 * - Integer overflow/underflow protection
 * - Edge cases and boundary conditions
 * - Merkle proof tampering
 * - Oracle operator validation
 */

describe("Security & Edge Cases", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  before(async () => {
    console.log("🔒 Setting up security test environment...");

    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();

    // Initialize global test environment
    await env.initialize();

    console.log("✅ Security test environment ready");
  });

  describe("Replay Attack Prevention", () => {
    it("should prevent double joining by same player", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const player = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 4,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        player.player,
        mint.mint
      );

      // First join should succeed
      await testUtils.game.joinGame(gameData.gamePDA, player.player);

      // Second join attempt should fail
      try {
        await testUtils.game.joinGame(gameData.gamePDA, player.player);
        expect.fail("Should have prevented double join");
      } catch (error) {
        expect(error.toString()).to.include("AlreadyJoined");
      }
    });

    it("should prevent reusing game PDA with same hash", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game first time
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Try to initialize same game again
      try {
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          creator.player,
          mint.mint
        );
        expect.fail("Should have prevented game PDA reuse");
      } catch (error) {
        // Should fail due to account already existing
        expect(error.toString()).to.include("already in use");
      }
    });

    it("should prevent completing game multiple times", async () => {
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

      // Create and fill game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Complete game first time
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
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

      // Try to complete again
      try {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          oracle.operator,
          winnerParticipation,
          []
        );
        expect.fail("Should have prevented double completion");
      } catch (error) {
        expect(error.toString()).to.include("GameAlreadyCompleted");
      }
    });
  });

  describe("Unauthorized Access Protection", () => {
    it("should reject unauthorized oracle operator", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;
      const fakeOperator = anchor.web3.Keypair.generate();

      // Fund fake operator with SOL for transaction fees
      const airdropSignature = await env.provider.connection.requestAirdrop(
        fakeOperator.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await env.provider.connection.confirmTransaction(airdropSignature);

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
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

      // Try to complete with fake operator
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
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

      try {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          fakeOperator.publicKey, // Wrong operator
          winnerParticipation,
          [],
          fakeOperator // Pass the keypair for signing
        );
        expect.fail("Should have rejected fake operator");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedOperator");
      }
    });

    it("should reject non-participant claiming winnings", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;
      const nonParticipant = players[2];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Create and fill game (only creator and player1)
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Try to complete with non-participant as winner
      const fakeParticipation = {
        player: nonParticipant.player.publicKey, // Not in game
        ticketIndex: 0,
      };

      try {
        await testUtils.game.completeGame(
          gameData,
          nonParticipant.player.publicKey,
          creator.player.publicKey,
          oracle.operator,
          fakeParticipation,
          []
        );
        expect.fail("Should have rejected non-participant");
      } catch (error) {
        expect(error.toString()).to.include("InvalidMerkleProof");
      }
    });

    it("should reject invalid creator in game completion", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;
      const fakeCreator = players[2];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
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

      // Try to complete with wrong creator
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
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

      try {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          fakeCreator.player.publicKey, // Wrong creator
          oracle.operator,
          winnerParticipation,
          []
        );
        expect.fail("Should have rejected wrong creator");
      } catch (error) {
        expect(error.toString()).to.include("InvalidCreator");
      }
    });
  });

  describe("Game State Manipulation", () => {
    it("should prevent joining expired games", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];
      const player = players[1];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 4,
        minTickets: 2,
        timeout: 1, // Very short timeout - 1 second
        isPrivate: false,
      };

      // Initialize game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      // Wait for timeout to expire
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to join expired game
      try {
        await testUtils.game.joinGame(gameData.gamePDA, player.player);
        expect.fail("Should have prevented joining expired game");
      } catch (error) {
        expect(error.toString()).to.include("GameExpired");
      }
    });

    it("should prevent joining full games", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1, player2] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2, // Max 2 players
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize and fill game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Try to join full game
      try {
        await testUtils.game.joinGame(gameData.gamePDA, player2.player);
        expect.fail("Should have prevented joining full game");
      } catch (error) {
        expect(error.toString()).to.include("GameFull");
      }
    });

    it("should enforce minimum player requirements", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 4,
        minTickets: 3, // Requires 3 players
        timeout: 3600,
        isPrivate: false,
      };

      // Initialize game with only 1 player
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      // Try to complete with insufficient players
      const winnerParticipation = {
        player: creator.player.publicKey,
        ticketIndex: 0,
      };

      try {
        await testUtils.game.completeGame(
          gameData,
          creator.player.publicKey,
          creator.player.publicKey,
          oracle.operator,
          winnerParticipation,
          []
        );
        expect.fail("Should have enforced minimum player requirement");
      } catch (error) {
        expect(error.toString()).to.include("GameNotReadyForOracle");
      }
    });
  });

  describe("Integer Overflow/Underflow Protection", () => {
    it("should handle maximum amount safely", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      // Use very large amount (close to u64 max)
      const maxAmount = new anchor.BN("18446744073709551615"); // u64::MAX

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: maxAmount,
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          creator.player,
          mint.mint
        );

        // Game should initialize but player won't have enough tokens to join
        try {
          await testUtils.game.joinGame(gameData.gamePDA, creator.player);
          expect.fail("Should have insufficient balance for max amount");
        } catch (error) {
          expect(error.toString()).to.include("InsufficientBalance");
        }
      } catch (error) {
        // Game initialization might also fail with such large amounts
        expect(error.toString()).to.include("InvalidAmount");
      }
    });

    it("should reject zero amounts for coinflip games", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(0), // Zero amount
        maxTickets: 2,
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          creator.player,
          mint.mint
        );
        expect.fail("Should have rejected zero amount");
      } catch (error) {
        expect(error.toString()).to.include("InvalidAmount");
      }
    });

    it("should handle maximum player count safely", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 255, // Max u8
        minTickets: 2,
        timeout: 3600,
        isPrivate: false,
      };

      try {
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          creator.player,
          mint.mint
        );

        // Should handle large player count configuration
        const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
        expect(gameAccount.maxTickets).to.equal(255);
      } catch (error) {
        // Might fail due to oracle constraints
        expect(error.toString()).to.include("InvalidTicketsCount");
      }
    });
  });

  describe("Merkle Proof Security", () => {
    it("should reject invalid merkle proofs", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 5, // Use all available players to trigger merkle tree structure
        minTickets: 5,
        timeout: 3600,
        isPrivate: false,
      };

      // Create game with all 5 players to trigger merkle tree usage
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        players[0].player,
        mint.mint
      );

      // Join all players
      for (let i = 0; i < 5; i++) {
        await testUtils.game.joinGame(gameData.gamePDA, players[i].player);
      }

      // Force winner to be one of the first 4 players (indices 0-3) who are in committed subtrees
      // This ensures merkle proof validation is tested, not recent player buffer validation
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const actualWinnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      
      // Use a player from committed subtrees (indices 0-3) to test merkle proof validation
      const testWinnerIndex = actualWinnerIndex >= 4 ? 0 : actualWinnerIndex; // Force to committed subtree if in recent buffer
      const testWinner = getWinnerFromPlayers(players.slice(0, 5), testWinnerIndex);

      const winnerParticipation = {
        player: testWinner.player.publicKey,
        ticketIndex: testWinnerIndex,
      };

      // Try to complete with invalid merkle proof
      const invalidProof = [
        Array.from({ length: 32 }, () => 255), // All 0xFF bytes
        Array.from({ length: 32 }, () => 0),   // All 0x00 bytes
      ];

      try {
        await testUtils.game.completeGame(
          gameData,
          testWinner.player.publicKey,
          players[0].player.publicKey,
          oracle.operator,
          winnerParticipation,
          invalidProof
        );
        expect.fail("Should have rejected invalid merkle proof");
      } catch (error) {
        expect(error.toString()).to.include("InvalidMerkleProof");
      }
    });

    it("should reject tampered participation entries", async () => {
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

      // Create and fill game
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);

      // Calculate actual winner to make test deterministic
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const actualWinner = getWinnerFromPlayers([creator, player1], winnerIndex);

      // Create correct participation entry but wrong winner account
      const correctParticipation = {
        player: actualWinner.player.publicKey, // Correct player
        ticketIndex: winnerIndex, // Correct index
      };

      // Use the OTHER player's account as winner to trigger WinnerPubkeyMismatch
      const wrongWinnerAccount = actualWinner.player.publicKey.equals(creator.player.publicKey) 
        ? player1.player.publicKey 
        : creator.player.publicKey;

      try {
        await testUtils.game.completeGame(
          gameData,
          wrongWinnerAccount, // Wrong winner account
          creator.player.publicKey,
          oracle.operator,
          correctParticipation,
          []
        );
        expect.fail("Should have rejected tampered participation");
      } catch (error) {
        expect(error.toString()).to.include("WinnerPubkeyMismatch");
      }
    });
  });

  describe("Edge Case Handling", () => {
    it("should handle single player giveaway correctly", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { giveaway: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 1, // Set max to 1 so game is immediately ready
        minTickets: 1, // Allow single player
        timeout: 3600,
        isPrivate: false,
      };

      // Create single-player giveaway
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      // Complete single-player game
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      expect(winnerIndex).to.equal(0); // Only one player

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

    it("should handle boundary timeout values", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      // Test minimum timeout
      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: 2,
        minTickets: 2,
        timeout: 1, // Minimum timeout
        isPrivate: false,
      };

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );

      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      expect(gameAccount.timeout).to.equal(1);
    });

    it("should handle maximum players configuration", async () => {
      const oracle = await testUtils.oracle.getOracle();

      // Test with oracle's maximum player limit
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const creator = players[0];

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxTickets: oracle.config.maxTickets, // Use oracle's max
        minTickets: 2,
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
      expect(gameAccount.maxTickets).to.equal(oracle.config.maxTickets);
    });
  });

  describe("Oracle Security", () => {
    it("should prevent unauthorized oracle updates", async () => {
      const fakeOperator = anchor.web3.Keypair.generate();

      // Fund fake operator with SOL for transaction fees
      const airdropSignature = await env.provider.connection.requestAirdrop(
        fakeOperator.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await env.provider.connection.confirmTransaction(airdropSignature);

      const newConfig = {
        feePercentage: 10, // High fee
        oracleBufferTime: 1,
        maxTickets: 2,
        maxTimeout: 60,
        minTimeout: 1,
      };

      try {
        await env.program.methods
          .updateOracle(newConfig)
          .accounts({
            oldOracleOperator: fakeOperator.publicKey,
            newOracleOperator: fakeOperator.publicKey,
          })
          .signers([fakeOperator])
          .rpc();

        expect.fail("Should have prevented unauthorized oracle update");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedOperator");
      }
    });

    it("should validate oracle configuration parameters", async () => {
      const oracle = await testUtils.oracle.getOracle();

      // Try to set invalid configuration
      const invalidConfig = {
        feePercentage: 101, // Over 100%
        oracleBufferTime: 1,
        maxTickets: 1, // Too low for coinflip
        maxTimeout: 0, // Invalid timeout
        minTimeout: 1,
      };

      try {
        await env.program.methods
          .updateOracle(invalidConfig)
          .accounts({
            oldOracleOperator: oracle.operator,
            newOracleOperator: oracle.operator,
          })
          .signers([oracle.operatorKeypair])
          .rpc();

        expect.fail("Should have rejected invalid oracle config");
      } catch (error) {
        // Should fail due to validation - fee percentage over 100% should trigger InvalidAmount
        expect(error.toString()).to.include("InvalidAmount");
      }
    });
  });
});
