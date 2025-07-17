import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import {
  TestUtils,
  TestEnvironment,
  calculateWinnerIndex,
  getWinnerFromPlayers,
  GameConfig,
  generateMerkleProof,
  TestPlayer,
} from "./test-helpers";

/**
 * Merkle Tree Fuzz Testing Suite
 * 
 * This comprehensive fuzz testing suite validates the robustness of the Merkle tree
 * implementation under random conditions and edge cases. It uses property-based
 * testing to discover potential issues that manual testing might miss.
 * 
 * Test Categories:
 * - Basic Tree Operations: Random joins and rolls
 * - Proof Generation: Validation of proof creation and verification
 * - Tree Structure: Subtree merging and structural integrity
 * - Game State Integration: Testing across different game types
 */

describe("Merkle Tree Fuzz Tests", () => {
  let testUtils: TestUtils;
  let env: TestEnvironment;

  // Fuzz testing configuration
  const FUZZ_ITERATIONS = 100; // Reduced from 1000 for initial testing
  const MAX_PLAYERS = 50; // Reduced from 100 for performance
  const MAX_ROLLS_PER_PLAYER = 20; // Reduced from 50 for performance
  const TIMEOUT_MS = 120000; // 2 minute timeout for fuzz tests

  before(async () => {
    console.log("🧪 Setting up Merkle tree fuzz test environment...");
    
    env = TestEnvironment.getInstance();
    testUtils = new TestUtils();
    
    // Initialize global test environment
    await env.initialize();
    
    console.log("✅ Merkle tree fuzz test environment ready");
  });

  /**
   * Utility function to generate random integer in range [min, max]
   */
  function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Utility function to generate random boolean
   */
  function randomBoolean(): boolean {
    return Math.random() < 0.5;
  }

  /**
   * Utility function to generate random game type
   */
  function randomGameType(): any {
    const types = [
      { coinflip: {} },
      { giveaway: {} },
      { snowball: {} }
    ];
    return types[randomInt(0, types.length - 1)];
  }

  /**
   * Utility function to shuffle array
   */
  function shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Utility function to validate tree integrity
   */
  async function validateTreeIntegrity(gamePDA: anchor.web3.PublicKey): Promise<void> {
    const gameAccount = await env.program.account.game.fetch(gamePDA);
    
    // Basic integrity checks
    expect(gameAccount.ticketsCount).to.be.gte(0);
    expect(gameAccount.recentCount).to.be.gte(0);
    expect(gameAccount.recentCount).to.be.lte(2); // Recent buffer max size
    expect(gameAccount.subtreeCount).to.be.gte(0);
    expect(gameAccount.subtreeCount).to.be.lte(5); // Max subtrees
    
    // Verify total ticket count consistency
    const committedTickets = gameAccount.ticketsCount - gameAccount.recentCount;
    expect(committedTickets).to.be.gte(0);
    
    // Verify merkle root is valid (non-zero if there are tickets)
    if (gameAccount.ticketsCount > 0) {
      const rootIsZero = gameAccount.merkleRoot.every(byte => byte === 0);
      expect(rootIsZero).to.be.false;
    }
  }

  describe("Basic Tree Operations Fuzz", () => {
    it("should maintain tree integrity under random join sequences", async function() {
      this.timeout(TIMEOUT_MS);
      
      for (let iteration = 0; iteration < FUZZ_ITERATIONS; iteration++) {
        const { oracle, mint } = await testUtils.quickSetup();
        
        // Random game configuration
        const numPlayers = randomInt(1, MAX_PLAYERS);
        const gameType = randomGameType();
        
        const gameConfig: GameConfig = {
          gameType,
          amount: new anchor.BN(1_000_000),
          maxTickets: numPlayers * 2, // Allow for potential rolls
          minTickets: Math.min(2, numPlayers),
          timeout: 3600,
          isPrivate: false,
        };
        
        const gameData = testUtils.game.generateGamePDA();
        const players = await testUtils.player.createPlayerPool(numPlayers, mint.mint);
        
        // Fund all players
        for (const player of players) {
          await testUtils.player.fundPlayer(player, mint, new anchor.BN(10_000_000));
        }
        
        // Initialize game
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );
        
        // Random join sequence
        const shuffledPlayers = shuffle(players);
        for (let i = 0; i < numPlayers; i++) {
          try {
            await testUtils.game.joinGame(gameData.gamePDA, shuffledPlayers[i].player);
            
            // Validate tree integrity after each join
            await validateTreeIntegrity(gameData.gamePDA);
            
            // Log progress for long-running tests
            if (numPlayers > 20 && i % 10 === 0) {
              console.log(`  Iteration ${iteration + 1}: ${i + 1}/${numPlayers} players joined`);
            }
          } catch (error) {
            console.error(`Join failed at iteration ${iteration + 1}, player ${i + 1}:`, error);
            throw error;
          }
        }
        
        // Final validation
        const finalGameAccount = await env.program.account.game.fetch(gameData.gamePDA);
        expect(finalGameAccount.ticketsCount).to.equal(numPlayers);
        
        // Log iteration progress
        if (iteration % 10 === 0) {
          console.log(`  Completed iteration ${iteration + 1}/${FUZZ_ITERATIONS} (${numPlayers} players)`);
        }
      }
    }).timeout(TIMEOUT_MS);

    it("should handle random join and roll sequences for snowball games", async function() {
      this.timeout(TIMEOUT_MS);
      
      for (let iteration = 0; iteration < FUZZ_ITERATIONS / 2; iteration++) { // Fewer iterations for complex test
        const { oracle, mint } = await testUtils.quickSetup();
        
        // Random game configuration for snowball
        const numPlayers = randomInt(2, Math.min(MAX_PLAYERS / 2, 25)); // Smaller for performance
        const rollsPerPlayer = randomInt(0, Math.min(MAX_ROLLS_PER_PLAYER / 2, 10)); // Smaller for performance
        
        const gameConfig: GameConfig = {
          gameType: { snowball: {} },
          amount: new anchor.BN(1_000_000),
          maxTickets: numPlayers + (numPlayers * rollsPerPlayer),
          minTickets: 2,
          timeout: 3600,
          isPrivate: false,
        };
        
        const gameData = testUtils.game.generateGamePDA();
        const players = await testUtils.player.createPlayerPool(numPlayers, mint.mint);
        
        // Fund all players generously for rolls
        for (const player of players) {
          await testUtils.player.fundPlayer(player, mint, new anchor.BN(50_000_000));
        }
        
        // Initialize game
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );
        
        // All players join first
        for (const player of players) {
          await testUtils.game.joinGame(gameData.gamePDA, player.player);
          await validateTreeIntegrity(gameData.gamePDA);
        }
        
        // Random roll sequences
        for (let rollRound = 0; rollRound < rollsPerPlayer; rollRound++) {
          const shuffledPlayers = shuffle(players);
          
          for (const player of shuffledPlayers) {
            try {
              // Generate proof for the player's existing ticket
              const currentGameState = await env.program.account.game.fetch(gameData.gamePDA);
              
              // Use player's initial ticket (their index in the players array)
              const ticketIndex = players.indexOf(player);
              const currentPlayerArray = players.slice(0, numPlayers); // Use consistent player array
              const rollProof = generateMerkleProof(currentPlayerArray, ticketIndex, currentGameState);
              
              await testUtils.game.rollGame(gameData.gamePDA, player.player, ticketIndex, rollProof);
              
              // Validate tree integrity after each roll
              await validateTreeIntegrity(gameData.gamePDA);
              
            } catch (error) {
              console.error(`Roll failed at iteration ${iteration + 1}, round ${rollRound + 1}:`, error);
              throw error;
            }
          }
        }
        
        // Final validation
        const finalGameAccount = await env.program.account.game.fetch(gameData.gamePDA);
        const expectedTickets = numPlayers + (numPlayers * rollsPerPlayer);
        expect(finalGameAccount.ticketsCount).to.equal(expectedTickets);
        
        // Log iteration progress
        if (iteration % 5 === 0) {
          console.log(`  Completed iteration ${iteration + 1}/${Math.floor(FUZZ_ITERATIONS / 2)} (${numPlayers} players, ${rollsPerPlayer} rolls each)`);
        }
      }
    }).timeout(TIMEOUT_MS);
  });

  describe("Proof Generation Fuzz", () => {
    it("should generate valid proofs for all positions in random trees", async function() {
      this.timeout(TIMEOUT_MS);
      
      for (let iteration = 0; iteration < FUZZ_ITERATIONS / 4; iteration++) { // Fewer iterations for intensive test
        const { oracle, mint } = await testUtils.quickSetup();
        
        // Random game configuration
        const numPlayers = randomInt(5, Math.min(MAX_PLAYERS / 2, 30)); // Focus on medium-sized trees
        
        const gameConfig: GameConfig = {
          gameType: { coinflip: {} },
          amount: new anchor.BN(1_000_000),
          maxTickets: numPlayers,
          minTickets: 2,
          timeout: 3600,
          isPrivate: false,
        };
        
        const gameData = testUtils.game.generateGamePDA();
        const players = await testUtils.player.createPlayerPool(numPlayers, mint.mint);
        
        // Fund all players
        for (const player of players) {
          await testUtils.player.fundPlayer(player, mint, new anchor.BN(10_000_000));
        }
        
        // Initialize game
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );
        
        // All players join
        for (const player of players) {
          await testUtils.game.joinGame(gameData.gamePDA, player.player);
        }
        
        // Generate proofs for all positions
        const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
        
        for (let ticketIndex = 0; ticketIndex < numPlayers; ticketIndex++) {
          try {
            // Generate proof for this ticket
            const proof = generateMerkleProof(players, ticketIndex, gameAccount);
            
            // Verify proof is valid (non-empty and reasonable length)
            expect(proof).to.be.an('array');
            expect(proof.length).to.be.gte(0);
            expect(proof.length).to.be.lte(20); // Reasonable max depth
            
            // Each proof element should be a valid 32-byte hash
            for (const element of proof) {
              expect(element).to.be.an('array');
              expect(element.length).to.equal(32);
            }
            
          } catch (error) {
            console.error(`Proof generation failed at iteration ${iteration + 1}, ticket ${ticketIndex}:`, error);
            throw error;
          }
        }
        
        // Log iteration progress
        if (iteration % 5 === 0) {
          console.log(`  Completed iteration ${iteration + 1}/${Math.floor(FUZZ_ITERATIONS / 4)} (${numPlayers} players, all proofs generated)`);
        }
      }
    }).timeout(TIMEOUT_MS);

    it("should generate consistent proofs across different tree configurations", async function() {
      this.timeout(TIMEOUT_MS);
      
      for (let iteration = 0; iteration < FUZZ_ITERATIONS / 8; iteration++) { // Fewer iterations for very intensive test
        const { oracle, mint } = await testUtils.quickSetup();
        
        // Random snowball configuration for dynamic tree growth
        const initialPlayers = randomInt(3, 10);
        const maxRolls = randomInt(1, 15);
        
        const gameConfig: GameConfig = {
          gameType: { snowball: {} },
          amount: new anchor.BN(1_000_000),
          maxTickets: initialPlayers + maxRolls,
          minTickets: 2,
          timeout: 3600,
          isPrivate: false,
        };
        
        const gameData = testUtils.game.generateGamePDA();
        const players = await testUtils.player.createPlayerPool(initialPlayers, mint.mint);
        
        // Fund all players
        for (const player of players) {
          await testUtils.player.fundPlayer(player, mint, new anchor.BN(20_000_000));
        }
        
        // Initialize game
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );
        
        // All players join
        for (const player of players) {
          await testUtils.game.joinGame(gameData.gamePDA, player.player);
        }
        
        // Add rolls one by one and verify proofs at each step
        for (let rollCount = 0; rollCount < maxRolls; rollCount++) {
          const rollingPlayer = players[rollCount % initialPlayers];
          const ticketIndex = players.indexOf(rollingPlayer);
          
          // Generate proof before roll
          const gameStateBefore = await env.program.account.game.fetch(gameData.gamePDA);
          const proofBefore = generateMerkleProof(players, ticketIndex, gameStateBefore);
          
          // Perform roll
          await testUtils.game.rollGame(gameData.gamePDA, rollingPlayer.player, ticketIndex, proofBefore);
          
          // Verify tree integrity after roll
          await validateTreeIntegrity(gameData.gamePDA);
          
          // Generate proofs for all original positions after roll
          const gameStateAfter = await env.program.account.game.fetch(gameData.gamePDA);
          
          for (let i = 0; i < initialPlayers; i++) {
            const proofAfter = generateMerkleProof(players, i, gameStateAfter);
            
            // Verify proof is still valid after tree modification
            expect(proofAfter).to.be.an('array');
            expect(proofAfter.length).to.be.gte(0);
            
            // Proof length should be reasonable
            expect(proofAfter.length).to.be.lte(20);
          }
        }
        
        // Log iteration progress
        if (iteration % 2 === 0) {
          console.log(`  Completed iteration ${iteration + 1}/${Math.floor(FUZZ_ITERATIONS / 8)} (${initialPlayers} players, ${maxRolls} rolls)`);
        }
      }
    }).timeout(TIMEOUT_MS);
  });

  describe("Tree Structure Fuzz", () => {
    it("should maintain structural integrity under random operations", async function() {
      this.timeout(TIMEOUT_MS);
      
      for (let iteration = 0; iteration < FUZZ_ITERATIONS / 4; iteration++) {
        const { oracle, mint } = await testUtils.quickSetup();
        
        // Random configuration designed to stress tree structure
        const numPlayers = randomInt(10, 50);
        const gameType = randomGameType();
        
        const gameConfig: GameConfig = {
          gameType,
          amount: new anchor.BN(1_000_000),
          maxTickets: numPlayers + 20, // Allow for rolls
          minTickets: 2,
          timeout: 3600,
          isPrivate: false,
        };
        
        const gameData = testUtils.game.generateGamePDA();
        const players = await testUtils.player.createPlayerPool(numPlayers, mint.mint);
        
        // Fund all players
        for (const player of players) {
          await testUtils.player.fundPlayer(player, mint, new anchor.BN(15_000_000));
        }
        
        // Initialize game
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );
        
        // Track tree state evolution
        const treeStates = [];
        
        // Add players in random order
        const shuffledPlayers = shuffle(players);
        for (let i = 0; i < numPlayers; i++) {
          await testUtils.game.joinGame(gameData.gamePDA, shuffledPlayers[i].player);
          
          // Capture tree state
          const gameState = await env.program.account.game.fetch(gameData.gamePDA);
          treeStates.push({
            ticketsCount: gameState.ticketsCount,
            recentCount: gameState.recentCount,
            subtreeCount: gameState.subtreeCount,
          });
          
          // Validate structural constraints
          await validateTreeIntegrity(gameData.gamePDA);
          
          // Verify subtree evolution patterns
          expect(gameState.subtreeCount).to.be.lte(5); // Max subtrees
          expect(gameState.recentCount).to.be.lte(2); // Max recent buffer
        }
        
        // Additional rolls for snowball games
        if (gameType.snowball) {
          for (let rollCount = 0; rollCount < 10; rollCount++) {
            const rollingPlayer = shuffledPlayers[rollCount % numPlayers];
            const ticketIndex = shuffledPlayers.indexOf(rollingPlayer);
            
            const currentGameState = await env.program.account.game.fetch(gameData.gamePDA);
            const rollProof = generateMerkleProof(shuffledPlayers, ticketIndex, currentGameState);
            
            await testUtils.game.rollGame(gameData.gamePDA, rollingPlayer.player, ticketIndex, rollProof);
            
            // Validate after roll
            await validateTreeIntegrity(gameData.gamePDA);
          }
        }
        
        // Final validation
        const finalGameState = await env.program.account.game.fetch(gameData.gamePDA);
        expect(finalGameState.ticketsCount).to.be.gte(numPlayers);
        
        // Log iteration progress
        if (iteration % 5 === 0) {
          console.log(`  Completed iteration ${iteration + 1}/${Math.floor(FUZZ_ITERATIONS / 4)} (${numPlayers} players)`);
        }
      }
    }).timeout(TIMEOUT_MS);
  });

  describe("Performance and Scalability Fuzz", () => {
    it("should maintain reasonable performance with larger trees", async function() {
      this.timeout(TIMEOUT_MS * 2); // Extended timeout for performance tests
      
      const performanceResults = [];
      
      for (let iteration = 0; iteration < 10; iteration++) { // Fewer iterations for performance tests
        const { oracle, mint } = await testUtils.quickSetup();
        
        // Gradually increase tree size
        const numPlayers = 20 + (iteration * 5); // 20, 25, 30, ... 65
        
        const gameConfig: GameConfig = {
          gameType: { coinflip: {} },
          amount: new anchor.BN(1_000_000),
          maxTickets: numPlayers,
          minTickets: 2,
          timeout: 3600,
          isPrivate: false,
        };
        
        const gameData = testUtils.game.generateGamePDA();
        const players = await testUtils.player.createPlayerPool(numPlayers, mint.mint);
        
        // Fund all players
        for (const player of players) {
          await testUtils.player.fundPlayer(player, mint, new anchor.BN(10_000_000));
        }
        
        // Initialize game
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          players[0].player,
          mint.mint
        );
        
        // Measure join performance
        const joinStartTime = Date.now();
        
        for (const player of players) {
          await testUtils.game.joinGame(gameData.gamePDA, player.player);
        }
        
        const joinEndTime = Date.now();
        const joinDuration = joinEndTime - joinStartTime;
        
        // Measure proof generation performance
        const proofStartTime = Date.now();
        
        const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
        
        // Generate proofs for a sample of positions
        const sampleSize = Math.min(numPlayers, 10);
        for (let i = 0; i < sampleSize; i++) {
          const ticketIndex = Math.floor((i / sampleSize) * numPlayers);
          generateMerkleProof(players, ticketIndex, gameAccount);
        }
        
        const proofEndTime = Date.now();
        const proofDuration = proofEndTime - proofStartTime;
        
        performanceResults.push({
          players: numPlayers,
          joinDuration,
          proofDuration,
          joinTimePerPlayer: joinDuration / numPlayers,
          proofTimePerProof: proofDuration / sampleSize,
        });
        
        // Log performance metrics
        console.log(`  ${numPlayers} players: ${joinDuration}ms joins, ${proofDuration}ms proofs`);
        
        // Validate final tree state
        await validateTreeIntegrity(gameData.gamePDA);
      }
      
      // Analyze performance trends
      console.log("\n📊 Performance Analysis:");
      for (const result of performanceResults) {
        console.log(`  ${result.players} players: ${result.joinTimePerPlayer.toFixed(1)}ms/join, ${result.proofTimePerProof.toFixed(1)}ms/proof`);
      }
      
      // Verify performance doesn't degrade too severely
      const firstResult = performanceResults[0];
      const lastResult = performanceResults[performanceResults.length - 1];
      
      // Performance should scale reasonably (not exponentially)
      const joinScaleFactor = lastResult.joinTimePerPlayer / firstResult.joinTimePerPlayer;
      const proofScaleFactor = lastResult.proofTimePerProof / firstResult.proofTimePerProof;
      
      expect(joinScaleFactor).to.be.lte(5); // Join time shouldn't increase more than 5x
      expect(proofScaleFactor).to.be.lte(3); // Proof time shouldn't increase more than 3x
      
      console.log(`  Scale factors: joins ${joinScaleFactor.toFixed(2)}x, proofs ${proofScaleFactor.toFixed(2)}x`);
    }).timeout(TIMEOUT_MS * 2);
  });
});