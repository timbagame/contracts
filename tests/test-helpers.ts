import * as anchor from "@anchor-lang/core";
import { expect } from "chai";
import type { Timba } from "../target/types/timba.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  type TokenAccount,
} from "./token-client.ts";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

export const toBN = (value: anchor.BN | number): anchor.BN =>
  anchor.BN.isBN(value) ? value : new anchor.BN(value);

export const toNumber = (value: anchor.BN | number): number =>
  anchor.BN.isBN(value) ? value.toNumber() : value;

const DEFAULT_BUFFER_POLL_INTERVAL_MS = 750;
const DEFAULT_BUFFER_MAX_WAIT_MS = 120_000;
const CLOCK_STALL_POLLS_BEFORE_TICK = 2;
const TOKEN_ACCOUNT_READ_RETRIES = 4;

function disableBlockhashCaching(connection: anchor.web3.Connection): void {
  // Surfpool's transaction-driven blocks can expire web3.js's cached hash
  // during a long setup loop. The flag is an internal web3.js test escape hatch.
  (connection as unknown as { _disableBlockhashCaching: boolean })._disableBlockhashCaching = true;
}

const ORACLE_SEED = Buffer.from("oracle");

const DEFAULT_OPERATOR_SEED = new Uint8Array(32).fill(42);

export const DEFAULT_OPERATOR_KEYPAIR = anchor.web3.Keypair.fromSeed(DEFAULT_OPERATOR_SEED);

export function deriveOraclePda(programId: PublicKey): PublicKey {
  const [oraclePda] = PublicKey.findProgramAddressSync([ORACLE_SEED], programId);
  return oraclePda;
}

const gameTokenCache = new Map<string, { tokenMint: PublicKey; tokenProgram: PublicKey }>();

const DEFAULT_PLAYER_BALANCE = new anchor.BN(100_000_000);

export async function requestAndConfirmAirdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  lamports: number,
): Promise<anchor.web3.RpcResponseAndContext<anchor.web3.SignatureResult>> {
  const signature = await connection.requestAirdrop(pubkey, lamports);
  return connection.confirmTransaction(signature, "confirmed");
}

export function errorToString(error: unknown): string {
  return error instanceof Error ? error.toString() : String(error);
}

type TimbaEvents = anchor.IdlEvents<Timba>;
type TimbaEventName = keyof TimbaEvents;

export async function subscribeEvent<TEvent extends TimbaEventName>(
  program: anchor.Program<Timba>,
  eventName: TEvent,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<{
  wait: Promise<TimbaEvents[TEvent]>;
  dispose: () => Promise<void>;
}> {
  let settled = false;
  let resolveEvent: (value: TimbaEvents[TEvent]) => void;
  let rejectEvent: (reason?: unknown) => void;

  const wait = new Promise<TimbaEvents[TEvent]>((resolve, reject) => {
    resolveEvent = resolve;
    rejectEvent = reject;
  });

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectEvent(new Error(`${eventName} timeout`));
    }
  }, timeoutMs);

  const listenerId = await program.addEventListener(eventName, (event) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveEvent(event);
  });

  const dispose = async () => {
    clearTimeout(timer);
    if (listenerId !== undefined) {
      try {
        await program.removeEventListener(listenerId);
      } catch (error) {
        // Surfpool may remove a completed subscription before client cleanup.
        if (!errorToString(error).includes("doesn't exist")) {
          throw error;
        }
      }
    }
  };

  wait.catch(async () => {
    await dispose().catch(() => {});
  });

  return { wait, dispose };
}

export async function captureEvent<TEvent extends TimbaEventName>(
  program: anchor.Program<Timba>,
  eventName: TEvent,
  action: () => Promise<void>,
  options: { timeoutMs?: number } = {},
): Promise<TimbaEvents[TEvent]> {
  const subscription = await subscribeEvent(program, eventName, options);

  try {
    await action();
    return await subscription.wait;
  } finally {
    await subscription.dispose();
  }
}

/**
 * Shared test utilities for the Timba program test suite
 */

export interface TestPlayer {
  player: anchor.web3.Keypair;
  playerTokenAccount: TokenAccount;
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

type DerivedGameAccountsOptions = {
  player?: PublicKey;
  winner?: PublicKey;
  tokenMint?: PublicKey;
};

export type DerivedGameAccounts = {
  tokenMint: PublicKey;
  tokenProgram: PublicKey;
  oracle: PublicKey;
  gameToken: PublicKey;
  gameVault: PublicKey;
  gameTokenAccount: PublicKey;
  playerTokenAccount?: PublicKey;
  winnerTokenAccount?: PublicKey;
};

async function resolveTokenProgram(
  connection: anchor.web3.Connection,
  tokenMint: PublicKey,
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(tokenMint);

  if (!accountInfo) {
    throw new Error(`Token mint ${tokenMint.toBase58()} not found`);
  }

  if (!accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`SPL Token mint ${tokenMint.toBase58()} has an invalid owner`);
  }

  return TOKEN_PROGRAM_ID;
}

export interface TestOracle {
  oraclePDA: PublicKey;
  // Backwards compatibility alias: some tests expect `oracle`
  oracle?: PublicKey;
  operator: PublicKey;
  operatorKeypair: anchor.web3.Keypair;
  config: OracleConfig;
}

export function getOraclePublicKey(testOracle: TestOracle): PublicKey {
  const oraclePubkey = testOracle.oracle ?? testOracle.oraclePDA;

  if (!oraclePubkey) {
    throw new Error("Missing oracle public key: expected `oracle` or `oraclePDA` to be defined.");
  }

  return oraclePubkey;
}

export async function ensureOperatorAta(
  connection: anchor.web3.Connection,
  oracle: TestOracle,
  mint: PublicKey,
): Promise<PublicKey> {
  const tokenProgram = await resolveTokenProgram(connection, mint);

  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    oracle.operatorKeypair,
    mint,
    oracle.operator,
    undefined,
    undefined,
    undefined,
    tokenProgram,
  );

  return account.address;
}

export interface OracleConfig {
  feePercentage: number;
  feeRecipient: PublicKey;
  oracleBufferTime: number;
  maxTickets: number;
  maxTimeout: number;
  minTimeout: number;
}

type BufferReadyGameAccount = {
  createdAt: anchor.BN | number;
  timeout?: anchor.BN | number;
  config?: {
    timeout?: anchor.BN | number;
  };
};

export interface AwaitBufferExpiryOptions {
  /**
   * Override the provider used for fetching and advancing the clock.
   * Prefer this over `connection` so both operations target the same validator.
   */
  provider?: anchor.AnchorProvider;
  /** Override only the connection used for fetching the clock sysvar. */
  connection?: anchor.web3.Connection;
  /** Custom polling cadence in milliseconds. */
  pollIntervalMs?: number;
  /**
   * Maximum wall-clock duration to wait before triggering a single extension.
   * The helper allows one automatic extension before failing hard so that
   * transient slot stalls do not break long-running tests.
   */
  maxWaitMs?: number;
}

export async function getClockUnixTimestamp(connection: anchor.web3.Connection): Promise<number> {
  const clockInfo = await connection.getAccountInfo(anchor.web3.SYSVAR_CLOCK_PUBKEY);

  if (!clockInfo) {
    throw new Error("Clock sysvar account unavailable");
  }

  return Number(clockInfo.data.readBigInt64LE(32));
}

/**
 * Surfpool only advances its Clock sysvar when a transaction produces a block.
 * A zero-lamport self-transfer is state-neutral, while letting timeout tests
 * make progress on transaction-driven validators.
 */
async function tickClock(provider: anchor.AnchorProvider): Promise<void> {
  const transaction = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: provider.wallet.publicKey,
      lamports: 0,
    }),
  );

  await provider.sendAndConfirm(transaction);
}

function resolveTimeoutSeconds(gameAccount: BufferReadyGameAccount): number {
  if (gameAccount.timeout !== undefined) {
    return toNumber(gameAccount.timeout);
  }

  const configTimeout = gameAccount.config?.timeout;
  if (configTimeout !== undefined) {
    return toNumber(configTimeout);
  }

  throw new Error("Game account missing timeout information required for buffer calculation");
}

export async function awaitBufferExpiry(
  gameAccount: BufferReadyGameAccount,
  oracleConfig: OracleConfig,
  extraSlackSeconds = 2,
  options: AwaitBufferExpiryOptions = {},
): Promise<void> {
  const provider = options.provider ?? TestEnvironment.getInstance().provider;
  const connection = options.connection ?? provider.connection;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_BUFFER_POLL_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_BUFFER_MAX_WAIT_MS;

  const createdAtSeconds = toNumber(gameAccount.createdAt);
  const timeoutSeconds = resolveTimeoutSeconds(gameAccount);
  const bufferSeconds =
    typeof oracleConfig.oracleBufferTime === "number"
      ? oracleConfig.oracleBufferTime
      : toNumber(oracleConfig.oracleBufferTime);

  const targetTimestamp = createdAtSeconds + timeoutSeconds + bufferSeconds;
  const adjustedTarget = targetTimestamp + extraSlackSeconds;

  let start = Date.now();
  let extended = false;
  let previousClockTimestamp: number | undefined;
  let stalledPolls = 0;

  while (true) {
    const clockTimestamp = await getClockUnixTimestamp(connection);

    if (clockTimestamp >= adjustedTarget) {
      return;
    }

    if (clockTimestamp === previousClockTimestamp) {
      stalledPolls += 1;
      if (stalledPolls >= CLOCK_STALL_POLLS_BEFORE_TICK) {
        if (options.connection && !options.provider) {
          throw new Error(
            "Clock stalled on a custom connection; pass its provider so the same validator can be advanced.",
          );
        }
        await tickClock(provider);
        stalledPolls = 0;
      }
    } else {
      stalledPolls = 0;
    }
    previousClockTimestamp = clockTimestamp;

    if (Date.now() - start > maxWaitMs) {
      if (!extended) {
        console.warn(
          `[awaitBufferExpiry] Extending wait (clock=${clockTimestamp}, target=${adjustedTarget}).`,
        );
        extended = true;
        start = Date.now();
      } else {
        throw new Error(
          `Timed out waiting for oracle buffer expiry (target=${adjustedTarget}, clock=${clockTimestamp}).`,
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Wait until the timeout has elapsed but before the oracle buffer expires so a
 * completion instruction can be sent safely. This wraps `awaitBufferExpiry`
 * with a negative slack adjustment that keeps the wait bounded inside the
 * buffer window even if the helper needs to extend once due to slot stalls.
 */
export async function awaitOracleCompletionReady(
  gameAccount: BufferReadyGameAccount,
  oracleConfig: OracleConfig,
  extraSlackSeconds = 0.5,
  options: AwaitBufferExpiryOptions = {},
): Promise<void> {
  const bufferSeconds =
    typeof oracleConfig.oracleBufferTime === "number"
      ? oracleConfig.oracleBufferTime
      : toNumber(oracleConfig.oracleBufferTime);

  const boundedSlack =
    bufferSeconds > 0 ? Math.min(extraSlackSeconds, Math.max(bufferSeconds - 0.25, 0)) : 0;

  const adjustedSlack = -bufferSeconds + boundedSlack;

  await awaitBufferExpiry(gameAccount, oracleConfig, adjustedSlack, options);
}

export interface GameConfig {
  gameType: { coinflip: Record<string, never> } | { giveaway: Record<string, never> };
  amount: anchor.BN | number;
  // Permit raw numbers in tests (we'll coerce to proper types where needed)
  maxTickets: anchor.BN | number;
  minTickets: anchor.BN | number;
  timeout: anchor.BN | number;
  isPrivate: boolean;
}

type GameConfigOverrides = Partial<{
  amount: anchor.BN | number;
  maxTickets: anchor.BN | number;
  minTickets: anchor.BN | number;
  timeout: anchor.BN | number;
  isPrivate: boolean;
}>;

function buildGameConfig(base: GameConfig, overrides: GameConfigOverrides = {}): GameConfig {
  const merged: GameConfig = {
    ...base,
    ...overrides,
  };

  return {
    ...merged,
    amount: toBN(merged.amount),
    maxTickets: toBN(merged.maxTickets),
    minTickets: toBN(merged.minTickets),
    timeout: toBN(merged.timeout),
  };
}

export function coinflipGameConfig(overrides: GameConfigOverrides = {}): GameConfig {
  return buildGameConfig(
    {
      gameType: { coinflip: {} },
      amount: new anchor.BN(1_000_000),
      maxTickets: new anchor.BN(2),
      minTickets: new anchor.BN(2),
      timeout: new anchor.BN(3600),
      isPrivate: false,
    },
    overrides,
  );
}

export function giveawayGameConfig(overrides: GameConfigOverrides = {}): GameConfig {
  return buildGameConfig(
    {
      gameType: { giveaway: {} },
      amount: new anchor.BN(2_000_000),
      maxTickets: new anchor.BN(5),
      minTickets: new anchor.BN(1),
      timeout: new anchor.BN(1800),
      isPrivate: false,
    },
    overrides,
  );
}

/**
 * Global test state manager
 */
type StandardSetup = {
  oracle: TestOracle;
  mint: TestMint;
  players: TestPlayer[];
};

async function createStandardSetup(
  program: anchor.Program<Timba>,
  provider: anchor.AnchorProvider,
): Promise<StandardSetup> {
  const oracleManager = new OracleManager(program, provider);
  const mintManager = new MintManager(program, provider);
  const playerManager = new PlayerManager(provider);

  const oracle = await oracleManager.createOracle();
  const mint = await mintManager.createMint();
  const players = await playerManager.createPlayerPool(8, mint.mint);

  for (const player of players) {
    await playerManager.fundPlayer(player, mint, DEFAULT_PLAYER_BALANCE);
  }

  return { oracle, mint, players };
}

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
    disableBlockhashCaching(this.provider.connection);
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
  async initialize(): Promise<StandardSetup> {
    if (this.oracle && this.globalMint && this.playerPool.length > 0) {
      return {
        oracle: this.oracle,
        mint: this.globalMint,
        players: this.playerPool,
      };
    }

    const setup = await createStandardSetup(this.program, this.provider);

    this.oracle = setup.oracle;
    this.globalMint = setup.mint;
    this.mint = setup.mint; // alias for tests referencing env.mint
    this.playerPool = setup.players;

    // Create test utilities after base environment is established
    if (!this.testUtils) {
      this.testUtils = new TestUtils();
    }

    return setup;
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
      throw new Error(`Requested ${count} players, but only ${this.playerPool.length} available`);
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
      feeRecipient: DEFAULT_OPERATOR_KEYPAIR.publicKey,
      oracleBufferTime: 2,
      maxTickets: 50000,
      maxTimeout: 86400,
      minTimeout: 1,

      ...config,
    };

    const oraclePDA = deriveOraclePda(this.program.programId);

    // Use a deterministic keypair for tests so we can reuse it
    const operatorKeypair = DEFAULT_OPERATOR_KEYPAIR;

    try {
      // Check if oracle already exists and is properly initialized
      try {
        const existingOracle = await this.program.account.oracle.fetch(oraclePDA);
        // Oracle already initialized
        return {
          oraclePDA,
          oracle: oraclePDA,
          operator: existingOracle.operator,
          operatorKeypair,
          config: {
            feePercentage: existingOracle.feePercentage,
            feeRecipient: existingOracle.feeRecipient,
            oracleBufferTime: existingOracle.oracleBufferTime.toNumber(),
            maxTickets: existingOracle.maxTickets,
            maxTimeout: existingOracle.maxTimeout.toNumber(),
            minTimeout: existingOracle.minTimeout.toNumber(),
          },
        };
      } catch {
        // Oracle doesn't exist, proceed with initialization
      }

      // Airdrop SOL for rent to both provider and oracle operator
      await requestAndConfirmAirdrop(
        this.provider.connection,
        this.provider.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await requestAndConfirmAirdrop(
        this.provider.connection,
        operatorKeypair.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL,
      );

      const configForProgram = {
        feePercentage: defaultConfig.feePercentage,
        feeRecipient: defaultConfig.feeRecipient,
        oracleBufferTime: new anchor.BN(defaultConfig.oracleBufferTime),
        maxTickets: defaultConfig.maxTickets,
        maxTimeout: new anchor.BN(defaultConfig.maxTimeout),
        minTimeout: new anchor.BN(defaultConfig.minTimeout),
      };

      await this.program.methods
        .initializeOracle(configForProgram)
        .accounts({
          oracleOperator: operatorKeypair.publicKey,
          upgradeAuthority: this.provider.publicKey,
          programData: anchor.web3.PublicKey.findProgramAddressSync(
            [this.program.programId.toBuffer()],
            new anchor.web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
          )[0],
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
    const oraclePDA = deriveOraclePda(this.program.programId);

    const oracleAccount = await this.program.account.oracle.fetch(oraclePDA);

    // Use the same deterministic keypair as in createOracle
    const operatorKeypair = DEFAULT_OPERATOR_KEYPAIR;

    return {
      oraclePDA,
      oracle: oraclePDA,
      operator: oracleAccount.operator,
      operatorKeypair,
      config: {
        feePercentage: oracleAccount.feePercentage,
        feeRecipient: oracleAccount.feeRecipient,
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
type GameTokenDerivation = {
  gameToken: PublicKey;
  gameVault: PublicKey;
  gameTokenAccount: PublicKey;
};

export function computeGameTokenContext(
  program: anchor.Program<Timba>,
  tokenMint: PublicKey,
  tokenProgram: PublicKey,
): GameTokenDerivation {
  const [gameToken] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_token"), tokenMint.toBuffer()],
    program.programId,
  );

  const [gameVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_vault"), tokenMint.toBuffer()],
    program.programId,
  );

  const gameTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    gameVault,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  return { gameToken, gameVault, gameTokenAccount };
}

export class MintManager {
  private program: anchor.Program<Timba>;
  private provider: anchor.AnchorProvider;

  constructor(program: anchor.Program<Timba>, provider: anchor.AnchorProvider) {
    this.program = program;
    this.provider = provider;
  }

  async createMint(): Promise<TestMint> {
    const mintAuthority = anchor.web3.Keypair.generate();
    const tokenProgram = TOKEN_PROGRAM_ID;
    const decimals = 6;

    // Airdrop SOL to mint authority
    await requestAndConfirmAirdrop(
      this.provider.connection,
      mintAuthority.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL,
    );

    // Create mint
    const mint = await createMint(
      this.provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      decimals,
      undefined,
      undefined,
      tokenProgram,
    );

    // Get PDAs and token accounts
    const {
      gameToken: gameTokenPDA,
      gameVault: gameVaultPDA,
      gameTokenAccount,
    } = computeGameTokenContext(this.program, mint, tokenProgram);

    // Create required token accounts
    await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mintAuthority,
      mint,
      gameVaultPDA,
      true,
      undefined,
      undefined,
      tokenProgram,
    );

    await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mintAuthority,
      mint,
      this.provider.publicKey,
      undefined,
      undefined,
      undefined,
      tokenProgram,
    );

    // Get the oracle operator from the oracle account
    const oraclePDA = deriveOraclePda(this.program.programId);
    const oracleAccount = await this.program.account.oracle.fetch(oraclePDA);
    const oracleOperatorKeypair = DEFAULT_OPERATOR_KEYPAIR;

    await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      mintAuthority,
      mint,
      oracleAccount.feeRecipient,
      false,
      undefined,
      undefined,
      tokenProgram,
    );

    await this.program.methods
      .initializeToken()
      .accountsStrict({
        gameToken: gameTokenPDA,
        tokenMint: mint,
        gameVault: gameVaultPDA,
        gameTokenAccount,
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
    const { gameToken } = computeGameTokenContext(this.program, mint, TOKEN_PROGRAM_ID);
    return gameToken;
  }
  getGameVaultPDA(mint: PublicKey): PublicKey {
    const { gameVault } = computeGameTokenContext(this.program, mint, TOKEN_PROGRAM_ID);
    return gameVault;
  }

  async mintTokensToAccount(
    mint: TestMint,
    tokenAccount: PublicKey,
    amount: anchor.BN,
  ): Promise<void> {
    const amountBigInt = BigInt(amount.toString());
    if (amountBigInt === 0n) {
      return;
    }

    const mintInfo = await getMint(
      this.provider.connection,
      mint.mint,
      undefined,
      mint.tokenProgram,
    );
    const currentSupply = BigInt(mintInfo.supply.toString());
    const maxSupply = 0xffff_ffff_ffff_ffffn; // SPL Token total supply is u64::MAX
    const availableToMint = maxSupply > currentSupply ? maxSupply - currentSupply : 0n;
    const mintAmount = amountBigInt <= availableToMint ? amountBigInt : availableToMint;

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
      mint.tokenProgram,
    );
  }
}

export async function deriveGameAccounts(
  program: anchor.Program<Timba>,
  gamePDA: PublicKey,
  options: DerivedGameAccountsOptions = {},
): Promise<DerivedGameAccounts> {
  const cacheKey = gamePDA.toBase58();

  let tokenMint: PublicKey | undefined = options.tokenMint;
  let tokenProgram: PublicKey | undefined;

  if (!tokenMint) {
    try {
      const gameAccount = await program.account.game.fetch(gamePDA);
      tokenMint = new PublicKey(gameAccount.tokenMint);
    } catch (error) {
      const cached = gameTokenCache.get(cacheKey);
      if (cached) {
        tokenMint = cached.tokenMint;
        tokenProgram = cached.tokenProgram;
      } else {
        throw error;
      }
    }
  }

  if (!tokenMint) {
    throw new Error("Unable to derive game accounts: token mint could not be determined");
  }

  if (!tokenProgram) {
    tokenProgram = await resolveTokenProgram(program.provider.connection, tokenMint);
  }

  gameTokenCache.set(cacheKey, { tokenMint, tokenProgram });

  const oracle = deriveOraclePda(program.programId);

  const { gameToken, gameVault, gameTokenAccount } = computeGameTokenContext(
    program,
    tokenMint,
    tokenProgram,
  );

  const playerTokenAccount = options.player
    ? getAssociatedTokenAddressSync(
        tokenMint,
        options.player,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    : undefined;

  const winnerTokenAccount = options.winner
    ? getAssociatedTokenAddressSync(
        tokenMint,
        options.winner,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    : undefined;

  return {
    tokenMint,
    tokenProgram,
    oracle,
    gameToken,
    gameVault,
    gameTokenAccount,
    ...(playerTokenAccount ? { playerTokenAccount } : {}),
    ...(winnerTokenAccount ? { winnerTokenAccount } : {}),
  };
}

export function toGameTokenContext(derived: DerivedGameAccounts): GameTokenContextAccounts {
  return {
    tokenMint: derived.tokenMint,
    gameToken: derived.gameToken,
    gameVault: derived.gameVault,
    gameTokenAccount: derived.gameTokenAccount,
    tokenProgram: derived.tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

export function gameTokenContextFromMint(
  mint: TestMint,
  program?: anchor.Program<Timba>,
): GameTokenContextAccounts {
  const resolvedProgram = program ?? (anchor.workspace.Timba as anchor.Program<Timba>);

  const { gameToken, gameVault, gameTokenAccount } = computeGameTokenContext(
    resolvedProgram,
    mint.mint,
    mint.tokenProgram,
  );

  return {
    tokenMint: mint.mint,
    gameToken,
    gameVault,
    gameTokenAccount,
    tokenProgram: mint.tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
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

  private async preparePlayerAccount(
    player: anchor.web3.Keypair,
    mint: PublicKey,
    tokenProgram?: PublicKey,
  ): Promise<TestPlayer> {
    const resolvedTokenProgram =
      tokenProgram ?? (await resolveTokenProgram(this.provider.connection, mint));

    await requestAndConfirmAirdrop(
      this.provider.connection,
      player.publicKey,
      3 * anchor.web3.LAMPORTS_PER_SOL,
    );

    for (let attempt = 0; attempt < TOKEN_ACCOUNT_READ_RETRIES; attempt += 1) {
      try {
        const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
          this.provider.connection,
          player,
          mint,
          player.publicKey,
          undefined,
          undefined,
          undefined,
          resolvedTokenProgram,
        );

        return { player, playerTokenAccount };
      } catch (error) {
        const isDelayedAccountRead =
          error instanceof Error && error.name === "TokenAccountNotFoundError";

        if (!isDelayedAccountRead || attempt === TOKEN_ACCOUNT_READ_RETRIES - 1) {
          throw error;
        }

        await tickClock(this.provider);
      }
    }

    throw new Error("Player token account setup exhausted without returning");
  }

  async createPlayer(mint: PublicKey): Promise<TestPlayer> {
    const player = anchor.web3.Keypair.generate();
    return this.preparePlayerAccount(player, mint);
  }

  async createPlayerPool(count: number, mint: PublicKey): Promise<TestPlayer[]> {
    const players = Array.from({ length: count }, () => anchor.web3.Keypair.generate());

    const tokenProgram = await resolveTokenProgram(this.provider.connection, mint);

    const preparedPlayers: TestPlayer[] = [];

    // Surfpool can return an account read before a concurrent ATA creation is
    // visible. Player setup is not the capacity under test, so keep it serial.
    for (const player of players) {
      preparedPlayers.push(await this.preparePlayerAccount(player, mint, tokenProgram));
    }

    return preparedPlayers;
  }

  async fundPlayer(player: TestPlayer, mint: TestMint, amount: anchor.BN): Promise<void> {
    await this.mintManager.mintTokensToAccount(mint, player.playerTokenAccount.address, amount);
  }
}

/**
 * Game management utilities
 */
export type GameTokenContextAccounts = {
  tokenMint: PublicKey;
  gameToken: PublicKey;
  gameVault: PublicKey;
  gameTokenAccount: PublicKey;
  tokenProgram: PublicKey;
  associatedTokenProgram: PublicKey;
};

type CompleteGameAccounts = {
  game: PublicKey;
  gameTokenCtx: GameTokenContextAccounts;
  oracle: PublicKey;
  oracleOperator: PublicKey;
  winner: PublicKey;
  creator: PublicKey;
  winnerTokenAccount: PublicKey;
  feeRecipient: PublicKey;
  feeRecipientTokenAccount: PublicKey;
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
    const secretKeyBuffer = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
    const secretKey = Array.from(secretKeyBuffer);
    const randomHashBuffer = hash(Buffer.from(secretKeyBuffer));
    const randomHash = Array.from(randomHashBuffer);

    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), randomHashBuffer],
      this.program.programId,
    );

    return { gamePDA, randomHash, secretKey };
  }

  async fetchGame(gamePDA: PublicKey) {
    return this.program.account.game.fetch(gamePDA);
  }

  async initializeGame(
    gameData: TestGame,
    config: GameConfig,
    creator: anchor.web3.Keypair,
    tokenMint: PublicKey,
    oracleOperator: anchor.web3.Keypair = DEFAULT_OPERATOR_KEYPAIR,
  ): Promise<void> {
    const tokenProgram = await this.resolveTokenProgram(tokenMint);
    const oracle = deriveOraclePda(this.program.programId);
    const { gameToken, gameVault, gameTokenAccount } = computeGameTokenContext(
      this.program,
      tokenMint,
      tokenProgram,
    );
    const creatorTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      creator.publicKey,
      false,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const gameTokenCtx: GameTokenContextAccounts = {
      tokenMint,
      gameToken,
      gameVault,
      gameTokenAccount,
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    };
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
      .accountsStrict({
        game: gameData.gamePDA,
        creator: creator.publicKey,
        oracle,
        oracleOperator: oracleOperator.publicKey,
        gameTokenCtx,
        creatorTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator, oracleOperator])
      .rpc();

    gameTokenCache.set(gameData.gamePDA.toBase58(), {
      tokenMint,
      tokenProgram,
    });
  }

  async joinGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    oracleOperator?: anchor.web3.Keypair,
  ): Promise<void> {
    const derived = await deriveGameAccounts(this.program, gamePDA, {
      player: player.publicKey,
    });

    if (!derived.playerTokenAccount) {
      throw new Error("Missing player token account for joinGame");
    }

    const gameTokenCtx = toGameTokenContext(derived);
    const commonAccounts = {
      game: gamePDA,
      player: player.publicKey,
      playerTokenAccount: derived.playerTokenAccount,
      gameTokenCtx,
      oracle: derived.oracle,
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
      await this.program.methods.joinGame().accounts(commonAccounts).signers([player]).rpc();
    }
  }

  // rollGame helper not included (multi-participation disabled)

  async unjoinGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    authority?: anchor.web3.Keypair,
  ): Promise<string> {
    const derived = await deriveGameAccounts(this.program, gamePDA, {
      player: player.publicKey,
    });

    if (!derived.playerTokenAccount) {
      throw new Error("Missing player token account for unjoinGame");
    }

    const authoritySigner = authority ?? player;

    return this.program.methods
      .unjoinGame()
      .accountsStrict({
        game: gamePDA,
        player: player.publicKey,
        authority: authoritySigner.publicKey,
        oracle: derived.oracle,
        playerTokenAccount: derived.playerTokenAccount,
        gameTokenCtx: toGameTokenContext(derived),
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
    overrides?: Partial<CompleteGameAccounts>,
  ): Promise<void> {
    // Use provided oracle operator keypair or default to deterministic one
    const operatorKeypair = oracleOperatorKeypair || DEFAULT_OPERATOR_KEYPAIR;

    const accounts = await this.buildCompleteGameAccounts(
      gameData,
      winner,
      creator,
      oracleOperator,
      overrides,
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
    overrides: Partial<CompleteGameAccounts> = {},
  ): Promise<CompleteGameAccounts> {
    const derived = await deriveGameAccounts(this.program, gameData.gamePDA, {
      winner,
    });

    if (!derived.winnerTokenAccount) {
      throw new Error("Missing winner token account for completeGame");
    }

    const oracleAccount = await this.program.account.oracle.fetch(derived.oracle);
    const feeRecipient = oracleAccount.feeRecipient;
    const feeRecipientTokenAccount = getAssociatedTokenAddressSync(
      derived.tokenMint,
      feeRecipient,
      false,
      derived.tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const baseAccounts: CompleteGameAccounts = {
      game: gameData.gamePDA,
      gameTokenCtx: toGameTokenContext(derived),
      oracle: derived.oracle,
      oracleOperator,
      winner,
      creator,
      winnerTokenAccount: derived.winnerTokenAccount,
      feeRecipient,
      feeRecipientTokenAccount,
    };

    return { ...baseAccounts, ...overrides };
  }

  // Convenience wrapper for tests expecting createGame()
  async createGame(
    config: GameConfig,
    creator: anchor.web3.Keypair,
    tokenMint: PublicKey,
  ): Promise<TestGame> {
    const gameData = this.generateGamePDA();
    await this.initializeGame(gameData, config, creator, tokenMint);
    return gameData;
  }

  async createFilledGame(
    config: GameConfig,
    creator: TestPlayer,
    tokenMint: PublicKey,
    participants: TestPlayer[],
    { joinCreator = true }: { joinCreator?: boolean } = {},
  ): Promise<TestGame> {
    const gameData = this.generateGamePDA();
    await this.initializeGame(gameData, config, creator.player, tokenMint);

    if (joinCreator) {
      await this.joinGame(gameData.gamePDA, creator.player);
    }

    for (const participant of participants) {
      await this.joinGame(gameData.gamePDA, participant.player);
    }

    return gameData;
  }

  // Expose calculation helper for backward compatibility
  calculateWinnerIndex(ticketsCount: number, secretKey: number[], lastSlot: number): number {
    return calculateWinnerIndex(ticketsCount, secretKey, lastSlot);
  }
}

/**
 * Winner calculation utilities
 */
export function calculateWinnerIndex(
  ticketsCount: number,
  secretKey: number[],
  lastSlot: number,
): number {
  // Calculate entries: for Snowball games use total_amount/ticket_amount, for others use player count
  const nEntries = ticketsCount;

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
  const maxValid = BigInt("0xFFFFFFFFFFFFFFFF") - (BigInt("0xFFFFFFFFFFFFFFFF") % nPlayers);

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
export function getWinnerFromPlayers(players: TestPlayer[], winnerIndex: number): TestPlayer {
  if (winnerIndex >= players.length) {
    throw new Error(`Winner index ${winnerIndex} is out of bounds for ${players.length} players`);
  }
  return players[winnerIndex];
}

export interface GameOutcomeContext {
  gameAccount: anchor.IdlAccounts<Timba>["game"];
  winnerIndex: number;
  winner: TestPlayer;
  participants: TestPlayer[];
  pot: anchor.BN;
}

export async function computeGameOutcome(
  env: TestEnvironment,
  gameData: TestGame,
  participants: TestPlayer[],
): Promise<GameOutcomeContext> {
  const gameAccount = env.testUtils
    ? await env.testUtils.game.fetchGame(gameData.gamePDA)
    : await env.program.account.game.fetch(gameData.gamePDA);
  const winnerIndex = calculateWinnerIndex(
    gameAccount.ticketsCount,
    gameData.secretKey,
    Number(gameAccount.lastSlot),
  );
  const winner = getWinnerFromPlayers(participants, winnerIndex);
  const pot = new anchor.BN(gameAccount.totalAmount.toString());

  return { gameAccount, winnerIndex, winner, participants, pot };
}

export function calculatePayoutBreakdown(
  pot: anchor.BN,
  feePercentage: number,
): { fee: anchor.BN; winnerAmount: anchor.BN } {
  const fee = pot.mul(new anchor.BN(feePercentage)).div(new anchor.BN(100));
  const winnerAmount = pot.sub(fee);
  return { fee, winnerAmount };
}

const ANCHOR_ERROR_CODE_BY_NUMBER: Record<number, string> = {
  7000: "UnauthorizedOperator",
  7001: "UnauthorizedPlayer",
  7002: "InvalidCreator",
  7100: "GameFull",
  7101: "GameWaitingForOracle",
  7102: "GameNotReadyForOracle",
  7103: "GameHasActivePlayers",
  7207: "ParticipantNotFound",
};

function extractNumericProgramError(error: unknown): number | undefined {
  const message = getErrorMessage(error);

  const hexMatch = /custom program error:\s*0x([0-9a-fA-F]+)/i.exec(message);
  if (hexMatch?.[1]) {
    return Number.parseInt(hexMatch[1], 16);
  }

  const customMatch = /"Custom"\s*:\s*(\d+)/.exec(message);
  if (customMatch?.[1]) {
    return Number.parseInt(customMatch[1], 10);
  }

  const instructionMatch = /InstructionError\D+(\d+)\D+Custom\D+(\d+)/i.exec(message);
  if (instructionMatch?.[2]) {
    return Number.parseInt(instructionMatch[2], 10);
  }

  return undefined;
}

type AnchorErrorLike = {
  error?: {
    errorCode?: { code?: unknown };
    errorMessage?: unknown;
    errorLogs?: unknown;
  };
  message?: unknown;
  transactionLogs?: unknown;
  logs?: unknown;
  toString?: () => string;
};

function asAnchorError(error: unknown): AnchorErrorLike {
  return typeof error === "object" && error !== null ? (error as AnchorErrorLike) : {};
}

export function getErrorCode(error: unknown): string | undefined {
  const anchorCode = asAnchorError(error).error?.errorCode?.code;
  if (typeof anchorCode === "string" && anchorCode.length > 0) {
    return anchorCode;
  }

  const numeric = extractNumericProgramError(error);
  if (numeric === undefined) {
    return undefined;
  }

  return ANCHOR_ERROR_CODE_BY_NUMBER[numeric];
}

export function getErrorMessage(error: unknown): string {
  const err = asAnchorError(error);
  const rawMessage = err.error?.errorMessage ?? err.message ?? err.toString?.();
  const directMessage = typeof rawMessage === "string" ? rawMessage : undefined;

  const shouldInspectLogs = !directMessage || directMessage === "Unknown action 'undefined'";
  if (shouldInspectLogs) {
    const logs = err?.transactionLogs ?? err?.logs ?? err?.error?.errorLogs ?? undefined;
    if (Array.isArray(logs)) {
      for (const log of logs) {
        if (typeof log !== "string") continue;
        const match = /Error Message: (?<msg>[^.]+)/.exec(log);
        if (match?.groups?.msg) {
          return match.groups.msg;
        }
      }
    }
  }

  return directMessage ?? "Unknown error";
}

export async function expectAnchorError(
  promise: Promise<unknown>,
  code: string,
  { fallbackSubstring, message }: { fallbackSubstring?: string; message?: string } = {},
): Promise<void> {
  try {
    await promise;
    expect.fail(message ?? `Expected Anchor error code ${code}`);
  } catch (error: unknown) {
    const actualCode = getErrorCode(error);

    if (actualCode) {
      expect(actualCode).to.equal(code);
      return;
    }

    if (fallbackSubstring) {
      expect(getErrorMessage(error)).to.include(fallbackSubstring);
      return;
    }

    expect.fail(`Expected Anchor error code ${code} but received: ${getErrorMessage(error)}`);
  }
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
  async quickSetup(): Promise<StandardSetup> {
    const setup = await this.env.initialize();

    this.env.testUtils = this;

    await this.ensurePlayerBalances(setup);

    return setup;
  }

  private async ensurePlayerBalances(setup: StandardSetup): Promise<void> {
    const { mint, players } = setup;

    for (const player of players) {
      const balance = await this.env.provider.connection.getTokenAccountBalance(
        player.playerTokenAccount.address,
      );
      const currentAmount = new anchor.BN(balance.value.amount);

      if (currentAmount.gte(DEFAULT_PLAYER_BALANCE)) {
        continue;
      }

      const deficit = DEFAULT_PLAYER_BALANCE.sub(currentAmount);
      await this.player.fundPlayer(player, mint, deficit);
    }
  }
}

/**
 * Random utility functions for fuzz testing
 */
export const RandomUtils = {
  /**
   * Generate random integer in range [min, max] (inclusive)
   */
  randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * Generate random boolean with optional probability
   */
  randomBoolean(probability: number = 0.5): boolean {
    return Math.random() < probability;
  },

  /**
   * Generate random game type for testing
   */
  randomGameType(): GameConfig["gameType"] {
    const types: GameConfig["gameType"][] = [{ coinflip: {} }, { giveaway: {} }];
    return types[this.randomInt(0, types.length - 1)] ?? { coinflip: {} };
  },

  /**
   * Generate random game configuration for testing
   */
  randomGameConfig(maxPlayers: number = 100): GameConfig {
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
  },

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  },

  /**
   * Generate random token amount for testing
   */
  randomTokenAmount(min: number = 1000, max: number = 100_000_000): anchor.BN {
    return new anchor.BN(this.randomInt(min, max));
  },
};
