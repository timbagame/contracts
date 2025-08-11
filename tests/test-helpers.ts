import * as anchor from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

/**
 * Shared test utilities for the Coinflip program test suite
 */

export interface TestPlayer {
  player: anchor.web3.Keypair;
  playerTokenAccount: any;
  playerBalancePDA: PublicKey;
}

export interface TestMint {
  mint: PublicKey;
  mintAuthority: anchor.web3.Keypair;
  gameVaultPDA: PublicKey;
  gameTokenPDA: PublicKey;
}

export interface TestGame {
  gamePDA: PublicKey;
  randomHash: number[];
  secretKey: number[];
}

export interface TestOracle {
  oraclePDA: PublicKey;
  operator: PublicKey;
  operatorKeypair: anchor.web3.Keypair;
  config: OracleConfig;
}

export interface OracleConfig {
  feePercentage: number;
  oracleBufferTime: number;
  maxTickets: number;
  maxTimeout: number;
  minTimeout: number;
  filterCleanupBuffer: number;
}

export interface GameConfig {
  gameType: any;
  amount: anchor.BN;
  maxTickets: number;
  minTickets: number;
  timeout: anchor.BN;
  isPrivate: boolean;
}

/**
 * Global test state manager
 */
export class TestEnvironment {
  private static instance: TestEnvironment;

  public program: anchor.Program<Coinflip>;
  public provider: anchor.AnchorProvider;
  public oracle?: TestOracle;
  public globalMint?: TestMint;
  public playerPool: TestPlayer[] = [];

  private constructor() {
    this.provider = anchor.AnchorProvider.env();
    anchor.setProvider(this.provider);
    this.program = anchor.workspace.Coinflip as anchor.Program<Coinflip>;
  }

  public static getInstance(): TestEnvironment {
    if (!TestEnvironment.instance) {
      TestEnvironment.instance = new TestEnvironment();
    }
    return TestEnvironment.instance;
  }

  /**
   * Initialize the test environment with oracle and global mint
   */
  async initialize(): Promise<void> {
    // Initialize oracle
    const oracleManager = new OracleManager(this.program, this.provider);
    this.oracle = await oracleManager.createOracle();

    // Create global mint
    const mintManager = new MintManager(this.program, this.provider);
    this.globalMint = await mintManager.createMint();

    // Create player pool
    const playerManager = new PlayerManager(this.program, this.provider);
    this.playerPool = await playerManager.createPlayerPool(
      8,
      this.globalMint.mint
    );

    // Fund all players
    for (const player of this.playerPool) {
      await mintManager.mintTokensToAccount(
        this.globalMint,
        player.playerTokenAccount.address,
        new anchor.BN(100_000_000)
      );
    }

    // Test environment initialized
  }

  /**
   * Get a subset of players from the pool
   */
  getPlayers(count: number): TestPlayer[] {
    if (count > this.playerPool.length) {
      throw new Error(
        `Requested ${count} players, but only ${this.playerPool.length} available`
      );
    }
    return this.playerPool.slice(0, count);
  }

  /**
   * Clean up resources (if needed for specific tests)
   */
  async cleanup(): Promise<void> {
    // Implementation depends on cleanup needs
  }
}

/**
 * Oracle management utilities
 */
export class OracleManager {
  private program: anchor.Program<Coinflip>;
  private provider: anchor.AnchorProvider;

  constructor(
    program: anchor.Program<Coinflip>,
    provider: anchor.AnchorProvider
  ) {
    this.program = program;
    this.provider = provider;
  }

  async createOracle(config?: Partial<OracleConfig>): Promise<TestOracle> {
    const defaultConfig: OracleConfig = {
      feePercentage: 1,
      oracleBufferTime: 2,
      maxTickets: 50000,
      maxTimeout: 86400,
      minTimeout: 1,
      filterCleanupBuffer: 2,
      ...config,
    };

    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      this.program.programId
    );

    // Use a deterministic keypair for tests so we can reuse it
    const operatorKeypair = anchor.web3.Keypair.fromSeed(
      new Uint8Array(32).fill(42)
    );

    try {
      // Check if oracle already exists and is properly initialized
      try {
        const existingOracle = await this.program.account.oracle.fetch(
          oraclePDA
        );
        // Oracle already initialized
        return {
          oraclePDA,
          operator: existingOracle.operator,
          operatorKeypair,
          config: {
            feePercentage: existingOracle.feePercentage,
            oracleBufferTime: existingOracle.oracleBufferTime.toNumber(),
            maxTickets: existingOracle.maxTickets,
            maxTimeout: existingOracle.maxTimeout.toNumber(),
            minTimeout: existingOracle.minTimeout.toNumber(),
            filterCleanupBuffer: existingOracle.filterCleanupBuffer
              ? existingOracle.filterCleanupBuffer.toNumber()
              : 2, // Default if missing
          },
        };
      } catch (fetchError) {
        // Oracle doesn't exist, proceed with initialization
      }

      // Airdrop SOL for rent to both provider and oracle operator
      const providerAirdrop = await this.provider.connection.requestAirdrop(
        this.provider.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      const operatorAirdrop = await this.provider.connection.requestAirdrop(
        operatorKeypair.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );

      await this.provider.connection.confirmTransaction(providerAirdrop, "confirmed");
      await this.provider.connection.confirmTransaction(operatorAirdrop, "confirmed");

      const configForProgram = {
        feePercentage: defaultConfig.feePercentage,
        oracleBufferTime: new anchor.BN(defaultConfig.oracleBufferTime),
        maxTickets: defaultConfig.maxTickets,
        maxTimeout: new anchor.BN(defaultConfig.maxTimeout),
        minTimeout: new anchor.BN(defaultConfig.minTimeout),
        filterCleanupBuffer: new anchor.BN(defaultConfig.filterCleanupBuffer),
      };

      await this.program.methods
        .initializeOracle(configForProgram)
        .accounts({
          oracleOperator: operatorKeypair.publicKey,
        })
        .signers([operatorKeypair])
        .rpc();

      // Oracle initialized
    } catch (e) {
      console.error("Failed to initialize oracle:", e);
      throw e;
    }

    return {
      oraclePDA,
      operator: operatorKeypair.publicKey,
      operatorKeypair,
      config: defaultConfig,
    };
  }

  async getOracle(): Promise<TestOracle> {
    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      this.program.programId
    );

    const oracleAccount = await this.program.account.oracle.fetch(oraclePDA);

    // Use the same deterministic keypair as in createOracle
    const operatorKeypair = anchor.web3.Keypair.fromSeed(
      new Uint8Array(32).fill(42)
    );

    return {
      oraclePDA,
      operator: oracleAccount.operator,
      operatorKeypair,
      config: {
        feePercentage: oracleAccount.feePercentage,
        oracleBufferTime: oracleAccount.oracleBufferTime.toNumber(),
        maxTickets: oracleAccount.maxTickets,
        maxTimeout: oracleAccount.maxTimeout.toNumber(),
        minTimeout: oracleAccount.minTimeout.toNumber(),
        filterCleanupBuffer: (
          oracleAccount.filterCleanupBuffer || new anchor.BN(2)
        ).toNumber(),
      },
    };
  }
}

/**
 * Token and mint management utilities
 */
export class MintManager {
  private program: anchor.Program<Coinflip>;
  private provider: anchor.AnchorProvider;

  constructor(
    program: anchor.Program<Coinflip>,
    provider: anchor.AnchorProvider
  ) {
    this.program = program;
    this.provider = provider;
  }

  async createMint(): Promise<TestMint> {
    const mintAuthority = anchor.web3.Keypair.generate();

    // Airdrop SOL to mint authority
    const signature = await this.provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await this.provider.connection.confirmTransaction(signature, "confirmed");

    // Create mint
    const mint = await createMint(
      this.provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    // Get PDAs
    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      this.program.programId
    );

    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), mint.toBuffer()],
      this.program.programId
    );

    // Create required token accounts
    await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mintAuthority,
      mint,
      gameVaultPDA,
      true
    );

    await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mintAuthority,
      mint,
      this.provider.publicKey
    );

    // Initialize token config
    const tokenConfig = { minAmount: new anchor.BN(1000), enabled: true };

    // Get the oracle operator from the oracle account
    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      this.program.programId
    );
    const oracleAccount = await this.program.account.oracle.fetch(oraclePDA);
    const oracleOperatorKeypair = anchor.web3.Keypair.fromSeed(
      new Uint8Array(32).fill(42)
    );

    await this.program.methods
      .initializeToken(tokenConfig)
      .accounts({
        oracleOperator: oracleAccount.operator,
        tokenMint: mint,
      })
      .signers([oracleOperatorKeypair])
      .rpc();

    return {
      mint,
      mintAuthority,
      gameVaultPDA,
      gameTokenPDA,
    };
  }

  async mintTokensToAccount(
    mint: TestMint,
    tokenAccount: PublicKey,
    amount: anchor.BN
  ): Promise<void> {
    await mintTo(
      this.provider.connection,
      mint.mintAuthority,
      mint.mint,
      tokenAccount,
      mint.mintAuthority,
      amount.toNumber()
    );
  }
}

/**
 * Player management utilities
 */
export class PlayerManager {
  private program: anchor.Program<Coinflip>;
  private provider: anchor.AnchorProvider;
  private mintManager: MintManager;

  constructor(
    program: anchor.Program<Coinflip>,
    provider: anchor.AnchorProvider
  ) {
    this.program = program;
    this.provider = provider;
    this.mintManager = new MintManager(program, provider);
  }

  async createPlayer(mint: PublicKey): Promise<TestPlayer> {
    const player = anchor.web3.Keypair.generate();

    // Airdrop SOL for rent
    const signature = await this.provider.connection.requestAirdrop(
      player.publicKey,
      3 * anchor.web3.LAMPORTS_PER_SOL
    );
    await this.provider.connection.confirmTransaction(signature, "confirmed");

    // Create token account
    const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      player,
      mint,
      player.publicKey
    );

    // Initialize player balance
    await this.program.methods
      .initializePlayerBalance()
      .accounts({
        player: player.publicKey,
        tokenMint: mint,
      })
      .signers([player])
      .rpc();

    // Get player balance PDA
    const [playerBalancePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_games"),
        player.publicKey.toBuffer(),
        mint.toBuffer(),
      ],
      this.program.programId
    );

    return {
      player,
      playerTokenAccount,
      playerBalancePDA,
    };
  }

  async createPlayerPool(
    count: number,
    mint: PublicKey
  ): Promise<TestPlayer[]> {
    const players = Array.from({ length: count }, () =>
      anchor.web3.Keypair.generate()
    );

    // Batch airdrop SOL
    const airdropPromises = players.map((player) =>
      this.provider.connection.requestAirdrop(
        player.publicKey,
        3 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    const signatures = await Promise.all(airdropPromises);
    await Promise.all(
      signatures.map((signature) =>
        this.provider.connection.confirmTransaction(signature, "confirmed")
      )
    );

    // Create player data in parallel
    const playerPromises = players.map(async (player) => {
      const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        player,
        mint,
        player.publicKey
      );

      await this.program.methods
        .initializePlayerGames()
        .accounts({
          player: player.publicKey,
          tokenMint: mint,
        })
        .signers([player])
        .rpc();

      const [playerBalancePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_games"),
          player.publicKey.toBuffer(),
          mint.toBuffer(),
        ],
        this.program.programId
      );

      return { player, playerTokenAccount, playerBalancePDA };
    });

    return Promise.all(playerPromises);
  }

  async fundPlayer(
    player: TestPlayer,
    mint: TestMint,
    amount: anchor.BN
  ): Promise<void> {
    await this.mintManager.mintTokensToAccount(
      mint,
      player.playerTokenAccount.address,
      amount
    );
  }
}

/**
 * Game management utilities
 */
export class GameManager {
  private program: anchor.Program<Coinflip>;

  constructor(program: anchor.Program<Coinflip>) {
    this.program = program;
  }

  generateGamePDA(): TestGame {
    const secretKeyBuffer = anchor.web3.Keypair.generate().secretKey.slice(
      0,
      32
    );
    const secretKey = Array.from(secretKeyBuffer);
    const randomHashBuffer = hash(Buffer.from(secretKeyBuffer));
    const randomHash = Array.from(randomHashBuffer);

    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), randomHashBuffer],
      this.program.programId
    );

    return { gamePDA, randomHash, secretKey };
  }

  async initializeGame(
    gameData: TestGame,
    config: GameConfig,
    creator: anchor.web3.Keypair,
    tokenMint: PublicKey
  ): Promise<void> {
    // Normalize config fields to Anchor-compatible types (u64 -> BN)
    const cfg: any = {
      gameType: config.gameType,
      amount:
        // Allow tests to pass either BN or number
        (anchor.BN.isBN && (config as any).amount && (config as any).amount.isZero !== undefined)
          ? (config as any).amount
          : new anchor.BN((config as any).amount),
      maxTickets: config.maxTickets,
      minTickets: config.minTickets,
      timeout:
        (anchor.BN.isBN && (config as any).timeout && (config as any).timeout.isZero !== undefined)
          ? (config as any).timeout
          : new anchor.BN((config as any).timeout),
      isPrivate: config.isPrivate,
    };

    await this.program.methods
      .initializeGame(cfg, gameData.randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint,
      })
      .signers([creator])
      .rpc();
  }

  async joinGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    oracleOperator?: anchor.web3.Keypair
  ): Promise<void> {
    const accounts: any = {
      game: gamePDA,
      player: player.publicKey,
    };

    const signers = [player];

    if (oracleOperator) {
      accounts.oracleOperator = oracleOperator.publicKey;
      signers.push(oracleOperator);
    }

    await this.program.methods
      .joinGame()
      .accounts(accounts)
      .signers(signers)
      .rpc();
  }

  async rollGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    oracleOperator?: anchor.web3.Keypair
  ): Promise<void> {
    const accounts: any = {
      game: gamePDA,
      player: player.publicKey,
    };

    const signers = [player];

    if (oracleOperator) {
      accounts.oracleOperator = oracleOperator.publicKey;
      signers.push(oracleOperator);
    }

    await this.program.methods
      .rollGame()
      .accountsPartial(accounts)
      .signers(signers)
      .rpc();
  }

  async unjoinGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    ticketIndex: number = 0
  ): Promise<void> {
    await this.program.methods
      .unjoinGame(ticketIndex)
      .accountsPartial({
        game: gamePDA,
        player: player.publicKey,
      })
      .signers([player])
      .rpc();
  }

  async completeGame(
    gameData: TestGame,
    winner: PublicKey,
    creator: PublicKey,
    oracleOperator: PublicKey,
    winnerIndex: number,
    oracleOperatorKeypair?: anchor.web3.Keypair
  ): Promise<void> {
    // Use provided oracle operator keypair or default to deterministic one
    const operatorKeypair =
      oracleOperatorKeypair ||
      anchor.web3.Keypair.fromSeed(new Uint8Array(32).fill(42));

    await this.program.methods
      .completeGame(gameData.randomHash, gameData.secretKey, winnerIndex)
      .accountsPartial({
        oracleOperator,
        winner,
        creator,
      })
      .signers([operatorKeypair])
      .rpc();
  }
}

/**
 * Winner calculation utilities
 */
export function calculateWinnerIndex(
  ticketsCount: number,
  secretKey: number[],
  lastSlot: number,
  gameType?: any,
  totalAmount?: number,
  ticketAmount?: number
): number {
  // Calculate entries: for Snowball games use total_amount/ticket_amount, for others use player count
  let nEntries: number;
  if (gameType && gameType.snowball && totalAmount && ticketAmount) {
    nEntries = totalAmount / ticketAmount;
  } else {
    nEntries = ticketsCount;
  }

  if (nEntries === 1) {
    return 0;
  }

  const nPlayers = BigInt(nEntries);

  // Hash combination of secret key and last_slot for additional entropy
  const combinedData = new Uint8Array(40);
  combinedData.set(secretKey, 0);

  // Convert lastSlot to little-endian bytes
  const lastSlotBytes = new Uint8Array(8);
  const lastSlotView = new DataView(lastSlotBytes.buffer);
  lastSlotView.setBigUint64(0, BigInt(lastSlot), true);
  combinedData.set(lastSlotBytes, 32);

  const entropyHash = hash(Buffer.from(combinedData));

  // Try sliding 8-byte windows through the hashed entropy
  const maxValid =
    BigInt("0xFFFFFFFFFFFFFFFF") - (BigInt("0xFFFFFFFFFFFFFFFF") % nPlayers);

  for (let startPos = 0; startPos <= 32 - 8; startPos++) {
    const randomBytes = entropyHash.subarray(startPos, startPos + 8);
    const randomU64 = new DataView(randomBytes.buffer).getBigUint64(0, true);

    if (randomU64 < maxValid) {
      return Number(randomU64 % nPlayers);
    }
  }

  throw new Error("Unable to generate unbiased random number");
}

/**
 * Helper function to get the winner from a list of players
 */
export function getWinnerFromPlayers(
  players: TestPlayer[],
  winnerIndex: number
): TestPlayer {
  if (winnerIndex >= players.length) {
    throw new Error(
      `Winner index ${winnerIndex} is out of bounds for ${players.length} players`
    );
  }
  return players[winnerIndex];
}

/**
 * Hashes a buffer using SHA-256 and returns the digest as a Buffer
 */
function hash(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Utility class that combines all managers for easy access
 */
export class TestUtils {
  public oracle: OracleManager;
  public mint: MintManager;
  public player: PlayerManager;
  public game: GameManager;
  public env: TestEnvironment;

  constructor() {
    this.env = TestEnvironment.getInstance();
    this.oracle = new OracleManager(this.env.program, this.env.provider);
    this.mint = new MintManager(this.env.program, this.env.provider);
    this.player = new PlayerManager(this.env.program, this.env.provider);
    this.game = new GameManager(this.env.program);
  }

  /**
   * Quick setup for a standard test scenario
   */
  async quickSetup(): Promise<{
    oracle: TestOracle;
    mint: TestMint;
    players: TestPlayer[];
  }> {
    const oracle = await this.oracle.createOracle();
    const mint = await this.mint.createMint();
    const players = await this.player.createPlayerPool(8, mint.mint);

    // Fund all players with tokens (100 million for extensive testing)
    for (const player of players) {
      await this.player.fundPlayer(player, mint, new anchor.BN(100_000_000));
    }

    return { oracle, mint, players };
  }
}

/**
 * Random utility functions for fuzz testing
 */
export class RandomUtils {
  /**
   * Generate random integer in range [min, max] (inclusive)
   */
  static randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generate random boolean with optional probability
   */
  static randomBoolean(probability: number = 0.5): boolean {
    return Math.random() < probability;
  }

  /**
   * Generate random game type for testing
   */
  static randomGameType(): any {
    const types = [{ coinflip: {} }, { giveaway: {} }, { snowball: {} }];
    return types[this.randomInt(0, types.length - 1)];
  }

  /**
   * Generate random game configuration for testing
   */
  static randomGameConfig(maxPlayers: number = 100): GameConfig {
    const gameType = this.randomGameType();
    const maxTickets = this.randomInt(2, maxPlayers);
    const minTickets = this.randomInt(1, Math.min(maxTickets, 10));

    return {
      gameType,
      amount: new anchor.BN(this.randomInt(100_000, 10_000_000)),
      maxTickets,
      minTickets,
      timeout: new anchor.BN(this.randomInt(600, 7200)), // 10 minutes to 2 hours
      isPrivate: this.randomBoolean(0.1), // 10% chance of private game
    };
  }

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  static shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Generate random token amount for testing
   */
  static randomTokenAmount(
    min: number = 1000,
    max: number = 100_000_000
  ): anchor.BN {
    return new anchor.BN(this.randomInt(min, max));
  }
}

/**
 * Collision Detection Testing Utilities
 */
export class CollisionUtils {
  /**
   * Create collision scenario by generating games that hash to similar bloom filter positions
   */
  static async createCollisionScenario(
    testUtils: TestUtils,
    player: TestPlayer,
    mint: TestMint,
    gameCount: number = 25
  ): Promise<TestGame[]> {
    const games: TestGame[] = [];

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: 2,
      minTickets: 2,
      timeout: new anchor.BN(3600),
      isPrivate: false,
    };

    // Create many games to increase collision probability
    for (let i = 0; i < gameCount; i++) {
      const gameData = testUtils.game.generateGamePDA();

      await testUtils.game.initializeGame(
        gameData,
        gameConfig,
        player.player,
        mint.mint
      );

      await testUtils.game.joinGame(gameData.gamePDA, player.player);
      games.push(gameData);
    }

    return games;
  }

  /**
   * Simulate rapid join attempts to test collision detection
   */
  static async simulateRapidJoins(
    testUtils: TestUtils,
    player: TestPlayer,
    mint: TestMint,
    attemptCount: number = 20
  ): Promise<{ successful: number; rejected: number }> {
    let successful = 0;
    let rejected = 0;

    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: 2,
      minTickets: 2,
      timeout: new anchor.BN(60),
      isPrivate: false,
    };

    for (let i = 0; i < attemptCount; i++) {
      const gameData = testUtils.game.generateGamePDA();

      try {
        await testUtils.game.initializeGame(
          gameData,
          gameConfig,
          player.player,
          mint.mint
        );

        await testUtils.game.joinGame(gameData.gamePDA, player.player);
        successful++;
      } catch (error) {
        if (error.toString().includes("AlreadyJoined")) {
          rejected++;
        } else {
          throw error;
        }
      }
    }

    return { successful, rejected };
  }

  /**
   * Validate PlayerBalance filter state for testing
   */
  static async validateFilterState(
    program: anchor.Program<Coinflip>,
    playerBalancePDA: anchor.web3.PublicKey
  ): Promise<{
    activeFilterIndex: number;
    filterCleaningScheduledAt: number;
    emergencyUnjoinMode: boolean;
    filterALastUpdated: number;
    filterBLastUpdated: number;
    filterALongestExpiry: number;
    filterBLongestExpiry: number;
  }> {
    const playerBalance = await program.account.playerBalance.fetch(
      playerBalancePDA
    );

    return {
      activeFilterIndex: playerBalance.activeFilterIndex,
      filterCleaningScheduledAt:
        playerBalance.filterCleaningScheduledAt.toNumber(),
      emergencyUnjoinMode: playerBalance.emergencyUnjoinMode,
      filterALastUpdated: playerBalance.filterALastUpdated.toNumber(),
      filterBLastUpdated: playerBalance.filterBLastUpdated.toNumber(),
      filterALongestExpiry: playerBalance.filterALongestExpiry.toNumber(),
      filterBLongestExpiry: playerBalance.filterBLongestExpiry.toNumber(),
    };
  }

  /**
   * Mock time advancement for testing cleanup schedules
   * Note: This waits for real time since we can't mock blockchain time
   */
  static async advanceTime(seconds: number): Promise<void> {
    console.log(`⏰ Advancing time by ${seconds} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Create test scenario for emergency mode activation
   */
  static async createEmergencyModeScenario(
    testUtils: TestUtils,
    player: TestPlayer,
    mint: TestMint
  ): Promise<{
    gameData: TestGame;
    collisionDetected: boolean;
    filterState: any;
  }> {
    // Create initial game
    const gameData = testUtils.game.generateGamePDA();
    const gameConfig: GameConfig = {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: 3,
      minTickets: 2,
      timeout: new anchor.BN(5), // Short timeout
      isPrivate: false,
    };

    await testUtils.game.initializeGame(
      gameData,
      gameConfig,
      player.player,
      mint.mint
    );

    await testUtils.game.joinGame(gameData.gamePDA, player.player);

    // Create many more games to trigger collision
    await this.createCollisionScenario(testUtils, player, mint, 20);

    // Check if collision was detected
    const env = TestEnvironment.getInstance();
    const filterState = await this.validateFilterState(
      env.program,
      player.playerBalancePDA
    );

    const collisionDetected = filterState.filterCleaningScheduledAt > 0;

    return { gameData, collisionDetected, filterState };
  }
}
