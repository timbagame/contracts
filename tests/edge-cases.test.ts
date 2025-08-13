import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { TestEnvironment, TestUtils } from "./test-helpers";

describe("Edge Case Testing", () => {
  let env: TestEnvironment;
  let testUtils: TestUtils;

  before(async () => {
    console.log("🔬 Setting up edge case test environment...");
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    await env.initialize();
    console.log("✅ Edge case test environment ready");
  });

  describe("Boundary Value Testing", () => {
    it("should handle maximum fee percentage (100%)", async () => {
      // Test fee percentage at maximum allowed value
      const maxFee = 100;

      // Update oracle with maximum fee
      await env.program.methods
        .updateOracle({
          feePercentage: maxFee,
          oracleBufferTime: new anchor.BN(env.oracle!.config.oracleBufferTime),
          maxTickets: env.oracle!.config.maxTickets,
          maxTimeout: new anchor.BN(env.oracle!.config.maxTimeout),
          minTimeout: new anchor.BN(env.oracle!.config.minTimeout),
          filterCleanupBuffer: new anchor.BN(
            env.oracle!.config.filterCleanupBuffer
          ),
        })
        .accounts({
          oldOracleOperator: env.oracle!.operator,
          newOracleOperator: env.oracle!.operator,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc();

      // Create and test game with 100% fee
      const creator = await env.createPlayer();
      const gameConfig = {
        maxTickets: new anchor.BN(2),
        minTickets: new anchor.BN(2),
        ticketAmount: new anchor.BN(1000),
        timeout: new anchor.BN(10),
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      const gameData = await testUtils.game.createGame(
        gameConfig as any,
        creator.player,
        env.mint!.mint
      );

      // Players join
      const player2 = await env.createPlayer();
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player2.player);

      // Wait for completion readiness
      await new Promise((resolve) => setTimeout(resolve, 11000));

      // Complete game
      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      const winnerIndex = testUtils.game.calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = winnerIndex === 0 ? creator : player2;

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        env.oracle.operator,
        winnerIndex
      );

      // Verify all funds went to fees (100% fee)
      const gameTokenPDA = testUtils.mint.getGameTokenPDA(env.mint!.mint);
      const gameToken = await env.program.account.gameToken.fetch(gameTokenPDA);
      expect(gameToken.feeAmount.toNumber()).to.equal(2000); // All 2000 tokens as fee

      // Reset oracle fee for other tests
      await env.program.methods
        .updateOracle({
          feePercentage: 5,
          oracleBufferTime: new anchor.BN(env.oracle!.config.oracleBufferTime),
          maxTickets: env.oracle!.config.maxTickets,
          maxTimeout: new anchor.BN(env.oracle!.config.maxTimeout),
          minTimeout: new anchor.BN(env.oracle!.config.minTimeout),
          filterCleanupBuffer: new anchor.BN(
            env.oracle!.config.filterCleanupBuffer
          ),
        })
        .accounts({
          oldOracleOperator: env.oracle!.operator,
          newOracleOperator: env.oracle!.operator,
        })
        .signers([env.oracle!.operatorKeypair])
        .rpc();
    });

    it("should handle minimum timeout values", async () => {
      const creator = await env.createPlayer();
      const minTimeout = 1; // 1 second minimum

      const gameConfig = {
        maxTickets: new anchor.BN(2),
        minTickets: new anchor.BN(1),
        ticketAmount: new anchor.BN(100),
        timeout: new anchor.BN(minTimeout),
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      const gameData = await testUtils.game.createGame(
        gameConfig as any,
        creator.player,
        env.mint!.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      // Wait minimal time for timeout
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const winnerIndex = 0;
      await testUtils.game.completeGame(
        gameData,
        creator.player.publicKey,
        creator.player.publicKey,
        env.oracle.operator,
        winnerIndex
      );

      console.log("✅ Minimum timeout handled successfully");
    });

    it("should handle maximum timeout values", async () => {
      const creator = await env.createPlayer();
      const maxTimeout = 86400; // 24 hours (theoretical max for testing)

      const gameConfig = {
        maxTickets: new anchor.BN(1),
        minTickets: new anchor.BN(1),
        ticketAmount: new anchor.BN(100),
        timeout: new anchor.BN(maxTimeout),
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      // Should create successfully
      const gameData = await testUtils.game.createGame(
        gameConfig as any,
        creator.player,
        env.mint!.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      // Verify game created with max timeout
      const game = await env.program.account.game.fetch(gameData.gamePDA);
      expect(game.timeout.toNumber()).to.equal(maxTimeout);

      console.log("✅ Maximum timeout handled successfully");
    });

    it("should handle maximum ticket amounts without overflow", async () => {
      const creator = await env.createPlayer();
      const maxAmount = new anchor.BN("18446744073709551615"); // Max u64 - 1

      // This should work for giveaways (creator funded)
      const gameConfig = {
        maxTickets: new anchor.BN(1),
        minTickets: new anchor.BN(1),
        ticketAmount: maxAmount,
        timeout: new anchor.BN(10),
        isPrivate: false,
        gameType: { giveaway: {} },
      };

      try {
        await testUtils.game.createGame(
          gameConfig as any,
          creator.player,
          env.mint!.mint
        );
        console.log("✅ Maximum amount handled successfully");
      } catch (error) {
        // Expected to fail due to insufficient tokens
        expect(error.toString()).to.include("InsufficientBalance");
        console.log(
          "✅ Maximum amount correctly rejected due to insufficient balance"
        );
      }
    });

    it("should handle edge case: min_tickets = max_tickets = 1", async () => {
      const creator = await env.createPlayer();

      const gameConfig = {
        maxTickets: new anchor.BN(1),
        minTickets: new anchor.BN(1),
        ticketAmount: new anchor.BN(100),
        timeout: new anchor.BN(5),
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      const gameData = await testUtils.game.createGame(
        gameConfig as any,
        creator.player,
        env.mint!.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, creator.player);

      // Should be immediately ready for completion
      const winnerIndex = 0;
      await testUtils.game.completeGame(
        gameData,
        creator.player.publicKey,
        creator.player.publicKey,
        env.oracle.operator,
        winnerIndex
      );

      console.log("✅ Single player game handled successfully");
    });
  });

  describe("Double Action Prevention", () => {
    it("should prevent double unjoin attempts", async () => {
      const creator = await env.createPlayer();
      const player2 = await env.createPlayer();

      const gameConfig = {
        maxTickets: new anchor.BN(2),
        minTickets: new anchor.BN(1),
        ticketAmount: new anchor.BN(100),
        timeout: new anchor.BN(2),
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      const gameData = await testUtils.game.createGame(
        gameConfig as any,
        creator.player,
        env.mint!.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player2.player);

      // Wait for emergency unjoin period
      const totalWaitTime =
        (gameConfig.timeout.toNumber() +
          env.oracle.config.oracleBufferTime +
          1) *
        1000;
      await new Promise((resolve) => setTimeout(resolve, totalWaitTime));

      // First unjoin should succeed
      await testUtils.game.unjoinGame(gameData.gamePDA, creator.player, 0);

      // Second unjoin should fail
      try {
        await testUtils.game.unjoinGame(gameData.gamePDA, creator.player, 0);
        expect.fail("Should have prevented double unjoin");
      } catch (error) {
        expect(error.toString()).to.include("AlreadyUnjoined");
        console.log("✅ Double unjoin correctly prevented");
      }
    });

    it("should prevent joining when game is full", async () => {
      const creator = await env.createPlayer();
      const player2 = await env.createPlayer();
      const player3 = await env.createPlayer();

      const gameConfig = {
        maxTickets: new anchor.BN(2),
        minTickets: new anchor.BN(2),
        ticketAmount: new anchor.BN(100),
        timeout: new anchor.BN(10),
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      const gameData = await testUtils.game.createGame(
        gameConfig as any,
        creator.player,
        env.mint!.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player2.player);

      // Third join should fail
      try {
        await testUtils.game.joinGame(gameData.gamePDA, player3.player);
        expect.fail("Should have prevented joining full game");
      } catch (error) {
        expect(error.toString()).to.include("GameFull");
        console.log("✅ Full game join correctly prevented");
      }
    });
  });

  describe("Constraint Validation", () => {
    it("should reject invalid ticket count ratios", async () => {
      const creator = await env.createPlayer();

      // min_tickets > max_tickets should fail
      const invalidConfig = {
        maxTickets: new anchor.BN(2),
        minTickets: new anchor.BN(5), // Invalid: min > max
        ticketAmount: new anchor.BN(100),
        timeout: new anchor.BN(10),
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      try {
        await testUtils.game.createGame(
          invalidConfig as any,
          creator.player,
          env.mint!.mint
        );
        expect.fail("Should have rejected invalid ticket count ratio");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTicketsCount");
        console.log("✅ Invalid ticket count ratio correctly rejected");
      }
    });

    it("should reject zero timeout", async () => {
      const creator = await env.createPlayer();

      const invalidConfig = {
        maxTickets: new anchor.BN(2),
        minTickets: new anchor.BN(1),
        ticketAmount: new anchor.BN(100),
        timeout: new anchor.BN(0), // Invalid: zero timeout
        isPrivate: false,
        gameType: { coinflip: {} },
      };

      try {
        await testUtils.game.createGame(
          invalidConfig as any,
          creator.player,
          env.mint!.mint
        );
        expect.fail("Should have rejected zero timeout");
      } catch (error) {
        expect(error.toString()).to.include("InvalidTimeout");
        console.log("✅ Zero timeout correctly rejected");
      }
    });

    it("should reject invalid fee percentage > 100", async () => {
      const invalidFee = 150; // 150% fee is invalid

      try {
        await env.program.methods
          .updateOracle({
            feePercentage: invalidFee,
            oracleBufferTime: new anchor.BN(
              env.oracle!.config.oracleBufferTime
            ),
            maxTickets: env.oracle!.config.maxTickets,
            maxTimeout: new anchor.BN(env.oracle!.config.maxTimeout),
            minTimeout: new anchor.BN(env.oracle!.config.minTimeout),
            filterCleanupBuffer: new anchor.BN(
              env.oracle!.config.filterCleanupBuffer
            ),
          })
          .accounts({
            oldOracleOperator: env.oracle!.operator,
            newOracleOperator: env.oracle!.operator,
          })
          .signers([env.oracle!.operatorKeypair])
          .rpc();
        expect.fail("Should have rejected fee > 100%");
      } catch (error) {
        expect(error.toString()).to.include("InvalidConfiguration");
        console.log("✅ Invalid fee percentage correctly rejected");
      }
    });
  });

  describe("Arithmetic Edge Cases", () => {
    it("should handle fee calculations without overflow", async () => {
      const creator = await env.createPlayer();

      // Large amount that could cause overflow in fee calculation
      const largeAmount = new anchor.BN("9223372036854775"); // Large but not max

      const gameConfig = {
        maxTickets: new anchor.BN(2),
        minTickets: new anchor.BN(2),
        ticketAmount: largeAmount,
        timeout: new anchor.BN(10),
        isPrivate: false,
        gameType: { giveaway: {} }, // Giveaway to avoid player balance issues
      };

      try {
        await testUtils.game.createGame(
          gameConfig as any,
          creator.player,
          env.mint!.mint
        );
        console.log("✅ Large amount fee calculation handled successfully");
      } catch (error) {
        // Expected to fail due to insufficient balance, not overflow
        expect(error.toString()).to.include("InsufficientBalance");
        console.log(
          "✅ Large amount correctly rejected due to balance, not overflow"
        );
      }
    });

    it("should handle zero amount giveaways", async () => {
      const creator = await env.createPlayer();

      const gameConfig = {
        maxTickets: new anchor.BN(3),
        minTickets: new anchor.BN(1),
        ticketAmount: new anchor.BN(0), // Zero amount giveaway
        timeout: new anchor.BN(5),
        isPrivate: false,
        gameType: { giveaway: {} },
      };

      const gameData = await testUtils.game.createGame(
        gameConfig as any,
        creator.player,
        env.mint!.mint
      );

      const player2 = await env.createPlayer();
      await testUtils.game.joinGame(gameData.gamePDA, creator.player);
      await testUtils.game.joinGame(gameData.gamePDA, player2.player);

      // Wait for completion readiness
      await new Promise((resolve) => setTimeout(resolve, 6000));

      const gameAccount = await env.program.account.game.fetch(
        gameData.gamePDA
      );
      const winnerIndex = testUtils.game.calculateWinnerIndex(
        gameAccount.ticketsCount,
        gameData.secretKey,
        Number(gameAccount.lastSlot)
      );
      const winner = winnerIndex === 0 ? creator : player2;

      await testUtils.game.completeGame(
        gameData,
        winner.player.publicKey,
        creator.player.publicKey,
        env.oracle.operator,
        winnerIndex
      );

      console.log("✅ Zero amount giveaway handled successfully");
    });
  });
});
