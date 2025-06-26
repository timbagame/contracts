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
 * - Oracle authority validation
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
        maxPlayers: 4,
        minPlayers: 2,
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
        maxPlayers: 2,
        minPlayers: 2,
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

      // Complete game first time
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

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        oracle.authority,
        winnerParticipation,
        []
      );

      // Try to complete again
      try {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          oracle.authority,
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
    it("should reject unauthorized oracle authority", async () => {
      const { mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1] = players;
      const fakeAuthority = anchor.web3.Keypair.generate();

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

      // Try to complete with fake authority
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
          fakeAuthority.publicKey, // Wrong authority
          winnerParticipation,
          []
        );
        expect.fail("Should have rejected fake authority");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedAuthority");
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
        maxPlayers: 2,
        minPlayers: 2,
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
        playerIndex: 0,
      };

      try {
        await testUtils.game.completeGame(
          gameData,
          nonParticipant.player.publicKey,
          creator.player.publicKey,
          oracle.authority,
          fakeParticipation,
          []
        );
        expect.fail("Should have rejected non-participant");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedPlayer");
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

      // Try to complete with wrong creator
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
          fakeCreator.player.publicKey, // Wrong creator
          oracle.authority,
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
        maxPlayers: 4,
        minPlayers: 2,
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
        maxPlayers: 2, // Max 2 players
        minPlayers: 2,
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
        maxPlayers: 4,
        minPlayers: 3, // Requires 3 players
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
        playerIndex: 0,
      };

      try {
        await testUtils.game.completeGame(
          gameData,
          creator.player.publicKey,
          creator.player.publicKey,
          oracle.authority,
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
        maxPlayers: 2,
        minPlayers: 2,
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
        maxPlayers: 2,
        minPlayers: 2,
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
        maxPlayers: 255, // Max u8
        minPlayers: 2,
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
        expect(gameAccount.maxPlayers).to.equal(255);
      } catch (error) {
        // Might fail due to oracle constraints
        expect(error.toString()).to.include("InvalidPlayersCount");
      }
    });
  });

  describe("Merkle Proof Security", () => {
    it("should reject invalid merkle proofs", async () => {
      const { oracle, mint, players } = await testUtils.quickSetup();
      const gameData = testUtils.game.generateGamePDA();
      const [creator, player1, player2] = players;

      const gameConfig: GameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1_000_000),
        maxPlayers: 3,
        minPlayers: 3,
        timeout: 3600,
        isPrivate: false,
      };

      // Create game with 3 players
      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        creator.player,
        mint.mint
      );
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player1.player);
      await testUtils.game.joinGame(gameData.gamePDA, player2.player);

      // Calculate correct winner
      const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
      const winnerIndex = calculateWinnerIndex(
        gameAccount.playersCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = getWinnerFromPlayers([creator, player1, player2], winnerIndex);

      const winnerParticipation = {
        player: winner.player.publicKey,
        playerIndex: winnerIndex,
      };

      // Try to complete with invalid merkle proof
      const invalidProof = [
        Array.from({ length: 32 }, () => 255), // All 0xFF bytes
        Array.from({ length: 32 }, () => 0),   // All 0x00 bytes
      ];

      try {
        await testUtils.game.completeGame(
          gameData,
          winner.player.publicKey,
          creator.player.publicKey,
          oracle.authority,
          winnerParticipation,
          invalidProof
        );
        expect.fail("Should have rejected invalid merkle proof");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedPlayer");
      }
    });

    it("should reject tampered participation entries", async () => {
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

      // Create tampered participation entry (wrong player for index)
      const tamperedParticipation = {
        player: creator.player.publicKey, // Wrong player
        playerIndex: 1, // Should be player1's index
      };

      try {
        await testUtils.game.completeGame(
          gameData,
          creator.player.publicKey,
          creator.player.publicKey,
          oracle.authority,
          tamperedParticipation,
          []
        );
        expect.fail("Should have rejected tampered participation");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedPlayer");
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
        maxPlayers: 1, // Set max to 1 so game is immediately ready
        minPlayers: 1, // Allow single player
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
        gameAccount.playersCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );

      expect(winnerIndex).to.equal(0); // Only one player

      const winnerParticipation = {
        player: creator.player.publicKey,
        playerIndex: winnerIndex,
      };

      await testUtils.game.completeGame(
        gameData,
        creator.player.publicKey,
        creator.player.publicKey,
        oracle.authority,
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
        maxPlayers: 2,
        minPlayers: 2,
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
        maxPlayers: oracle.config.maxPlayers, // Use oracle's max
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
      expect(gameAccount.maxPlayers).to.equal(oracle.config.maxPlayers);
    });
  });

  describe("Oracle Security", () => {
    it("should prevent unauthorized oracle updates", async () => {
      const fakeAuthority = anchor.web3.Keypair.generate();

      const newConfig = {
        feePercentage: 10, // High fee
        oracleBufferTime: 1,
        maxPlayers: 2,
        maxTimeout: 60,
        minTimeout: 1,
      };

      try {
        await env.program.methods
          .updateOracle(newConfig)
          .accounts({
            oldAuthority: fakeAuthority.publicKey,
            newAuthority: fakeAuthority.publicKey,
          })
          .signers([fakeAuthority])
          .rpc();

        expect.fail("Should have prevented unauthorized oracle update");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedAuthority");
      }
    });

    it("should validate oracle configuration parameters", async () => {
      const oracle = await testUtils.oracle.getOracle();

      // Try to set invalid configuration
      const invalidConfig = {
        feePercentage: 101, // Over 100%
        oracleBufferTime: 1,
        maxPlayers: 1, // Too low for coinflip
        maxTimeout: 0, // Invalid timeout
        minTimeout: 1,
      };

      try {
        await env.program.methods
          .updateOracle(invalidConfig)
          .accounts({
            oldAuthority: oracle.authority,
            newAuthority: oracle.authority,
          })
          .rpc();

        expect.fail("Should have rejected invalid oracle config");
      } catch (error) {
        // Should fail due to validation
        expect(error.toString()).to.include("InvalidConfiguration");
      }
    });
  });
});
