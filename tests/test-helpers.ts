import * as anchor from "@coral-xyz/anchor";
import { Timba } from "../target/types/timba";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

export const toBN = (value: anchor.BN | number): anchor.BN =>
  anchor.BN.isBN(value) ? value : new anchor.BN(value);

export const toNumber = (value: anchor.BN | number): number =>
  anchor.BN.isBN(value) ? value.toNumber() : value;

export function errorToString(error: unknown): string {
  return error instanceof Error ? error.toString() : String(error);
}

/**
 * Shared test utilities for the Timba program test suite
 */

export interface TestPlayer {
  player: anchor.web3.Keypair;
  playerTokenAccount: any;
}

export interface TestMint {
  mint: PublicKey;
  mintAuthority: anchor.web3.Keypair;
  gameVaultPDA: PublicKey;
  gameTokenPDA: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
}

export interface TestGame {
  gamePDA: PublicKey;
  randomHash: number[];
  secretKey: number[];
}

async function resolveTokenProgram(
  connection: anchor.web3.Connection,
  tokenMint: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(tokenMint);

  if (!accountInfo) {
    throw new Error(`Token mint ${tokenMint.toBase58()} not found`);
  }

  if (accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return TOKEN_PROGRAM_ID;
  }

  if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }

  throw new Error(`Token program unsupported for mint ${tokenMint.toBase58()}`);
}

export interface TestOracle {
  oraclePDA: PublicKey;
  // Backwards compatibility alias: some tests expect `oracle`
  oracle?: PublicKey;
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
}

export interface GameConfig {
  gameType: any;
  amount: anchor.BN | number;
  // Permit raw numbers in tests (we'll coerce to proper types where needed)
  maxTickets: anchor.BN | number;
  minTickets: anchor.BN | number;
  timeout: anchor.BN | number;
  isPrivate: boolean;
}

/**
 * Global test state manager
 */
export class TestEnvironment {
  private static instance: TestEnvironment;

  public program: anchor.Program<Timba>;
  public provider: anchor.AnchorProvider;
  public oracle?: TestOracle;
  public globalMint?: TestMint;
  public playerPool: TestPlayer[] = [];
  // Additional compatibility aliases expected by some tests
  public mint?: TestMint;
  public testUtils?: TestUtils;

  private constructor() {
    this.provider = anchor.AnchorProvider.env();
    anchor.setProvider(this.provider);
    this.program = anchor.workspace.Timba as anchor.Program<Timba>;
  }

  public static getInstance(): TestEnvironment {
    if (!TestEnvironment.instance) {
      TestEnvironment.instance = new TestEnvironment();
    }
    return TestEnvironment.instance;
  }

  /**
   * Utility: shuffle an array (compat with tests expecting TestEnvironment.shuffle)
   */
  static shuffle<T>(array: T[]): T[] {
    return RandomUtils.shuffle(array);
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
    this.mint = this.globalMint; // alias for tests referencing env.mint

    // Create player pool
    const playerManager = new PlayerManager(this.provider);
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

    // Create test utilities after base environment is established
    this.testUtils = new TestUtils();

    // Test environment initialized
  }

  // Backwards-compatible helper (some tests call env.createPlayer())
  public async createPlayer(): Promise<TestPlayer> {
    if (!this.globalMint) throw new Error("Environment not initialized");
    const pm = new PlayerManager(this.provider);
    return pm.createPlayer(this.globalMint.mint);
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
  private program: anchor.Program<Timba>;
  private provider: anchor.AnchorProvider;

  constructor(program: anchor.Program<Timba>, provider: anchor.AnchorProvider) {
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
          oracle: oraclePDA,
          operator: existingOracle.operator,
          operatorKeypair,
          config: {
            feePercentage: existingOracle.feePercentage,
            oracleBufferTime: existingOracle.oracleBufferTime.toNumber(),
            maxTickets: existingOracle.maxTickets,
            maxTimeout: existingOracle.maxTimeout.toNumber(),
            minTimeout: existingOracle.minTimeout.toNumber(),
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

      await this.provider.connection.confirmTransaction(
        providerAirdrop,
        "confirmed"
      );
      await this.provider.connection.confirmTransaction(
        operatorAirdrop,
        "confirmed"
      );

      const configForProgram = {
        feePercentage: defaultConfig.feePercentage,
        oracleBufferTime: new anchor.BN(defaultConfig.oracleBufferTime),
        maxTickets: defaultConfig.maxTickets,
        maxTimeout: new anchor.BN(defaultConfig.maxTimeout),
        minTimeout: new anchor.BN(defaultConfig.minTimeout),
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
      oracle: oraclePDA,
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
      oracle: oraclePDA,
      operator: oracleAccount.operator,
      operatorKeypair,
      config: {
        feePercentage: oracleAccount.feePercentage,
        oracleBufferTime: oracleAccount.oracleBufferTime.toNumber(),
        maxTickets: oracleAccount.maxTickets,
        maxTimeout: oracleAccount.maxTimeout.toNumber(),
        minTimeout: oracleAccount.minTimeout.toNumber(),
      },
    };
  }
}

/**
 * Token and mint management utilities
 */
export class MintManager {
  private program: anchor.Program<Timba>;
  private provider: anchor.AnchorProvider;

  constructor(program: anchor.Program<Timba>, provider: anchor.AnchorProvider) {
    this.program = program;
    this.provider = provider;
  }

  async createMint(options?: {
    tokenProgram?: PublicKey;
    decimals?: number;
  }): Promise<TestMint> {
    const mintAuthority = anchor.web3.Keypair.generate();
    const tokenProgram = options?.tokenProgram ?? TOKEN_PROGRAM_ID;
    const decimals = options?.decimals ?? 6;

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
      decimals,
      undefined,
      undefined,
      tokenProgram
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
    const gameVaultAta = await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mintAuthority,
      mint,
      gameVaultPDA,
      true,
      undefined,
      undefined,
      tokenProgram
    );

    await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mintAuthority,
      mint,
      this.provider.publicKey,
      undefined,
      undefined,
      undefined,
      tokenProgram
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
      .accountsStrict({
        gameToken: gameTokenPDA,
        tokenMint: mint,
        gameVault: gameVaultPDA,
        gameTokenAccount: gameVaultAta.address,
        oracle: oraclePDA,
        oracleOperator: oracleAccount.operator,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([oracleOperatorKeypair])
      .rpc();

    return {
      mint,
      mintAuthority,
      gameVaultPDA,
      gameTokenPDA,
      tokenProgram,
      decimals,
    };
  }

  // Helper getters used in some tests
  getGameTokenPDA(mint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), mint.toBuffer()],
      this.program.programId
    );
    return pda;
  }
  getGameVaultPDA(mint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      this.program.programId
    );
    return pda;
  }

  async mintTokensToAccount(
    mint: TestMint,
    tokenAccount: PublicKey,
    amount: anchor.BN
  ): Promise<void> {
    const amountBigInt = BigInt(amount.toString());
    if (amountBigInt === 0n) {
      return;
    }

    const mintInfo = await getMint(
      this.provider.connection,
      mint.mint,
      undefined,
      mint.tokenProgram
    );
    const currentSupply = BigInt(mintInfo.supply.toString());
    const maxSupply = 0xffff_ffff_ffff_ffffn; // SPL Token total supply is u64::MAX
    const availableToMint =
      maxSupply > currentSupply ? maxSupply - currentSupply : 0n;
    const mintAmount =
      amountBigInt <= availableToMint ? amountBigInt : availableToMint;

    if (mintAmount === 0n) {
      return;
    }

    await mintTo(
      this.provider.connection,
      mint.mintAuthority,
      mint.mint,
      tokenAccount,
      mint.mintAuthority,
      mintAmount,
      undefined,
      undefined,
      mint.tokenProgram
    );
  }
}

/**
 * Player management utilities
 */
export class PlayerManager {
  private program: anchor.Program<Timba>;
  private provider: anchor.AnchorProvider;
  private mintManager: MintManager;

  constructor(provider: anchor.AnchorProvider) {
    this.program = anchor.workspace.Timba as anchor.Program<Timba>;
    this.provider = provider;
    this.mintManager = new MintManager(this.program, provider);
  }

  async createPlayer(mint: PublicKey): Promise<TestPlayer> {
    const player = anchor.web3.Keypair.generate();
    const tokenProgram = await resolveTokenProgram(
      this.provider.connection,
      mint
    );

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
      player.publicKey,
      undefined,
      undefined,
      undefined,
      tokenProgram
    );

    return {
      player,
      playerTokenAccount,
    };
  }

  async createPlayerPool(
    count: number,
    mint: PublicKey
  ): Promise<TestPlayer[]> {
    const tokenProgram = await resolveTokenProgram(
      this.provider.connection,
      mint
    );
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
        player.publicKey,
        undefined,
        undefined,
        undefined,
        tokenProgram
      );

      return { player, playerTokenAccount };
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
type CompleteGameAccounts = {
  game: PublicKey;
  tokenMint: PublicKey;
  oracle: PublicKey;
  oracleOperator: PublicKey;
  winner: PublicKey;
  creator: PublicKey;
  gameToken: PublicKey;
  gameVault: PublicKey;
  winnerTokenAccount: PublicKey;
  gameTokenAccount: PublicKey;
  tokenProgram: PublicKey;
  systemProgram: PublicKey;
  associatedTokenProgram: PublicKey;
};

export class GameManager {
  private program: anchor.Program<Timba>;

  constructor(program: anchor.Program<Timba>) {
    this.program = program;
  }

  private async resolveTokenProgram(tokenMint: PublicKey): Promise<PublicKey> {
    return resolveTokenProgram(this.program.provider.connection, tokenMint);
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
    const tokenProgram = await this.resolveTokenProgram(tokenMint);
    const cfg = {
      gameType: config.gameType,
      amount: toBN(config.amount),
      maxTickets: toNumber(config.maxTickets),
      minTickets: toNumber(config.minTickets),
      timeout: toBN(config.timeout),
      isPrivate: config.isPrivate,
    };

    await this.program.methods
      .initializeGame(cfg, gameData.randomHash)
      .accounts({
        creator: creator.publicKey,
        tokenMint,
        tokenProgram,
      })
      .signers([creator])
      .rpc();
  }

  async joinGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    oracleOperator?: anchor.web3.Keypair
  ): Promise<void> {
    const gameAccount = await this.program.account.game.fetch(gamePDA);
    const tokenMint = new PublicKey(gameAccount.tokenMint);
    const tokenProgram = await this.resolveTokenProgram(tokenMint);

    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      this.program.programId
    );
    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), tokenMint.toBuffer()],
      this.program.programId
    );
    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), tokenMint.toBuffer()],
      this.program.programId
    );

    const playerTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      player.publicKey,
      false,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const gameTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      gameVaultPDA,
      true,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const commonAccounts = {
      game: gamePDA,
      player: player.publicKey,
      tokenMint,
      gameToken: gameTokenPDA,
      gameVault: gameVaultPDA,
      playerTokenAccount,
      gameTokenAccount,
      oracle: oraclePDA,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    };

    if (oracleOperator) {
      await this.program.methods
        .joinGame()
        .accounts({
          ...commonAccounts,
          oracleOperator: oracleOperator.publicKey,
        })
        .signers([player, oracleOperator])
        .rpc();
    } else {
      await this.program.methods
        .joinGame()
        .accounts(commonAccounts)
        .signers([player])
        .rpc();
    }
  }

  // rollGame helper not included (multi-participation disabled)

  async unjoinGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    authority?: anchor.web3.Keypair
  ): Promise<void> {
    const gameAccount = await this.program.account.game.fetch(gamePDA);
    const tokenMint = new PublicKey(gameAccount.tokenMint);
    const tokenProgram = await this.resolveTokenProgram(tokenMint);

    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      this.program.programId
    );
    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), tokenMint.toBuffer()],
      this.program.programId
    );
    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), tokenMint.toBuffer()],
      this.program.programId
    );

    const playerTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      player.publicKey,
      false,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const gameTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      gameVaultPDA,
      true,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const authoritySigner = authority ?? player;

    await this.program.methods
      .unjoinGame()
      .accountsStrict({
        game: gamePDA,
        player: player.publicKey,
        authority: authoritySigner.publicKey,
        tokenMint,
        oracle: oraclePDA,
        gameToken: gameTokenPDA,
        gameVault: gameVaultPDA,
        playerTokenAccount,
        gameTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([authoritySigner])
      .rpc();
  }

  async completeGame(
    gameData: TestGame,
    winner: PublicKey,
    creator: PublicKey,
    oracleOperator: PublicKey,
    winnerIndex: number,
    oracleOperatorKeypair?: anchor.web3.Keypair,
    overrides?: Partial<CompleteGameAccounts>
  ): Promise<void> {
    // Use provided oracle operator keypair or default to deterministic one
    const operatorKeypair =
      oracleOperatorKeypair ||
      anchor.web3.Keypair.fromSeed(new Uint8Array(32).fill(42));

    const accounts = await this.buildCompleteGameAccounts(
      gameData,
      winner,
      creator,
      oracleOperator,
      overrides
    );

    await this.program.methods
      .completeGame(gameData.randomHash, gameData.secretKey, winnerIndex)
      .accountsStrict(accounts)
      .signers([operatorKeypair])
      .rpc();
  }

  async buildCompleteGameAccounts(
    gameData: TestGame,
    winner: PublicKey,
    creator: PublicKey,
    oracleOperator: PublicKey,
    overrides: Partial<CompleteGameAccounts> = {}
  ): Promise<CompleteGameAccounts> {
    const gameAccount = await this.program.account.game.fetch(gameData.gamePDA);
    const tokenMint = new PublicKey(gameAccount.tokenMint);
    const tokenProgram = await this.resolveTokenProgram(tokenMint);

    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      this.program.programId
    );
    const [gameTokenPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_token"), tokenMint.toBuffer()],
      this.program.programId
    );
    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), tokenMint.toBuffer()],
      this.program.programId
    );

    const winnerTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      winner,
      false,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const gameTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      gameVaultPDA,
      true,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const baseAccounts: CompleteGameAccounts = {
      game: gameData.gamePDA,
      tokenMint,
      oracle: oraclePDA,
      oracleOperator,
      winner,
      creator,
      gameToken: gameTokenPDA,
      gameVault: gameVaultPDA,
      winnerTokenAccount,
      gameTokenAccount,
      tokenProgram,
      systemProgram: anchor.web3.SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    };

    return { ...baseAccounts, ...overrides };
  }

  // Convenience wrapper for tests expecting createGame()
  async createGame(
    config: GameConfig,
    creator: anchor.web3.Keypair,
    tokenMint: PublicKey
  ): Promise<TestGame> {
    const gameData = this.generateGamePDA();
    await this.initializeGame(gameData, config, creator, tokenMint);
    return gameData;
  }

  // Expose calculation helper for backward compatibility
  calculateWinnerIndex(
    ticketsCount: number,
    secretKey: number[],
    lastSlot: number
  ): number {
    return calculateWinnerIndex(ticketsCount, secretKey, lastSlot);
  }
}

/**
 * Winner calculation utilities
 */
export function calculateWinnerIndex(
  ticketsCount: number,
  secretKey: number[],
  lastSlot: number
): number {
  // Calculate entries: for Snowball games use total_amount/ticket_amount, for others use player count
  let nEntries: number;
  nEntries = ticketsCount;

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

export interface GameOutcomeContext {
  gameAccount: any;
  winnerIndex: number;
  winner: TestPlayer;
  participants: TestPlayer[];
  pot: anchor.BN;
}

export async function computeGameOutcome(
  env: TestEnvironment,
  gameData: TestGame,
  participants: TestPlayer[]
): Promise<GameOutcomeContext> {
  const gameAccount = await env.program.account.game.fetch(gameData.gamePDA);
  const winnerIndex = calculateWinnerIndex(
    gameAccount.ticketsCount,
    gameData.secretKey,
    Number(gameAccount.lastSlot)
  );
  const winner = getWinnerFromPlayers(participants, winnerIndex);
  const pot = new anchor.BN(gameAccount.totalAmount.toString());

  return { gameAccount, winnerIndex, winner, participants, pot };
}

export function calculatePayoutBreakdown(
  pot: anchor.BN,
  feePercentage: number
): { fee: anchor.BN; winnerAmount: anchor.BN } {
  const fee = pot.mul(new anchor.BN(feePercentage)).div(new anchor.BN(100));
  const winnerAmount = pot.sub(fee);
  return { fee, winnerAmount };
}

export function getErrorCode(error: unknown): string | undefined {
  return (error as any)?.error?.errorCode?.code;
}

export function getErrorMessage(error: unknown): string {
  const err = error as any;
  const directMessage =
    err?.error?.errorMessage ?? err?.message ?? err?.toString?.();

  const shouldInspectLogs =
    !directMessage || directMessage === "Unknown action 'undefined'";
  if (shouldInspectLogs) {
    const logs =
      err?.transactionLogs ?? err?.logs ?? err?.error?.errorLogs ?? undefined;
    if (Array.isArray(logs)) {
      for (const log of logs) {
        const match = /Error Message: (?<msg>[^.]+)/.exec(log);
        if (match?.groups?.msg) {
          return match.groups.msg;
        }
      }
    }
  }

  return directMessage ?? "Unknown error";
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
    this.player = new PlayerManager(this.env.provider);
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
    const types = [{ coinflip: {} }, { giveaway: {} }];
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
      maxTickets: new anchor.BN(maxTickets),
      minTickets: new anchor.BN(minTickets),
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
   * Generate a standard game configuration used for collision tests
   */
  private static gameConfig(timeout: number): GameConfig {
    return {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(timeout),
      isPrivate: false,
    };
  }

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
    const gameConfig = this.gameConfig(3600);

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

    const gameConfig = this.gameConfig(60);

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
        if (errorToString(error).includes("AlreadyJoined")) {
          rejected++;
        } else {
          throw error;
        }
      }
    }

    return { successful, rejected };
  }

  /**
   * Mock time advancement for testing cleanup schedules
   * Note: This waits for real time since we can't mock blockchain time
   */
  static async advanceTime(seconds: number): Promise<void> {
    console.log(`⏰ Advancing time by ${seconds} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}
