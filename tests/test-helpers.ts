import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect } from "bun:test";
import {
  address,
  appendTransactionMessageInstructions,
  assertIsFullySignedTransaction,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createClientWithGetMinimumBalanceFromRpc,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  generateKeyPairSigner,
  flattenInstructionPlan,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  lamports as lamportsAmount,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type FullySignedTransaction,
  type Instruction,
  type KeyPairSigner,
  type ReadonlyUint8Array,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS,
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getCreateMintInstructionPlan,
  getMintToInstruction,
} from "@solana-program/token";
import {
  GameType,
  TIMBA_PROGRAM_ADDRESS,
  fetchGame,
  fetchMaybeGame,
  fetchMaybeOracle,
  fetchOracle,
  findGamePda,
  findGameVaultPda,
  findOraclePda,
  getCompleteGameInstructionAsync,
  getInitializeGameInstructionAsync,
  getInitializeOracleInstructionAsync,
  getJoinGameInstructionAsync,
  getUnjoinGameInstructionAsync,
  type Game,
} from "./generated/index.ts";

const LAMPORTS_PER_SOL = 1_000_000_000n;
const DEFAULT_PLAYER_BALANCE = 100_000_000n;
const DEFAULT_BUFFER_POLL_INTERVAL_MS = 750;
const DEFAULT_BUFFER_MAX_WAIT_MS = 120_000;
const CLOCK_STALL_POLLS_BEFORE_TICK = 2;
const CONFIRMATION_TIMEOUT_MS = 60_000;
const CLOCK_SYSVAR_ADDRESS = address("SysvarC1ock11111111111111111111111111111111");
const UPGRADEABLE_LOADER_ADDRESS = address("BPFLoaderUpgradeab1e11111111111111111111111");

export type TestRpc = Rpc<SolanaRpcApi>;
type SignedTransaction = Transaction & FullySignedTransaction;
let defaultOperatorKeypair: Promise<KeyPairSigner> | undefined;

function getDefaultOperatorKeypair(): Promise<KeyPairSigner> {
  defaultOperatorKeypair ??= createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(42));
  return defaultOperatorKeypair;
}

function rpcUrl(): `${string}://${string}` {
  return (process.env["ANCHOR_PROVIDER_URL"] ?? "http://127.0.0.1:8899") as `${string}://${string}`;
}

async function loadPayer(): Promise<KeyPairSigner> {
  const walletPath = process.env["ANCHOR_WALLET"];
  if (!walletPath) throw new Error("ANCHOR_WALLET is required for contract integration tests");
  const bytes = JSON.parse(await readFile(walletPath, "utf8")) as number[];
  return createKeyPairSignerFromBytes(Uint8Array.from(bytes));
}

export function errorToString(error: unknown): string {
  if (error instanceof Error) {
    const context =
      "context" in error ? (error as Error & { context?: unknown }).context : undefined;
    if (context !== undefined) {
      return `${error.toString()} ${JSON.stringify(context, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      )}`;
    }
    return error.toString();
  }
  try {
    return JSON.stringify(error, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {
    return String(error);
  }
}

async function confirmTransaction(
  rpc: TestRpc,
  transactionSignature: Signature,
  lastValidBlockHeight?: bigint,
): Promise<void> {
  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [{ value: statuses }, blockHeight] = await Promise.all([
      rpc.getSignatureStatuses([transactionSignature], { searchTransactionHistory: true }).send(),
      rpc.getBlockHeight({ commitment: "confirmed" }).send(),
    ]);
    const status = statuses[0];
    if (status?.err) {
      throw new Error(
        `Transaction ${transactionSignature} failed: ${JSON.stringify(status.err, (_key, value) => (typeof value === "bigint" ? value.toString() : value))}`,
      );
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    if (lastValidBlockHeight !== undefined && blockHeight > lastValidBlockHeight) {
      throw new Error(`Transaction ${transactionSignature} expired before confirmation`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Transaction ${transactionSignature} confirmation timed out`);
}

export async function sendInstructions(
  rpc: TestRpc,
  feePayer: KeyPairSigner,
  instructions: readonly Instruction[],
): Promise<Signature> {
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(feePayer, transactionMessage),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(lifetime, transactionMessage),
    (transactionMessage) =>
      appendTransactionMessageInstructions([...instructions], transactionMessage),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsFullySignedTransaction(transaction);
  const transactionSignature = await rpc
    .sendTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  await confirmTransaction(rpc, transactionSignature, lifetime.lastValidBlockHeight);
  return transactionSignature;
}

export async function buildSignedTransaction(
  rpc: TestRpc,
  feePayer: KeyPairSigner,
  instructions: readonly Instruction[],
): Promise<{ transaction: SignedTransaction; lastValidBlockHeight: bigint }> {
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(feePayer, transactionMessage),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(lifetime, transactionMessage),
    (transactionMessage) =>
      appendTransactionMessageInstructions([...instructions], transactionMessage),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsFullySignedTransaction(transaction);
  return { transaction, lastValidBlockHeight: lifetime.lastValidBlockHeight };
}

export async function sendSignedTransaction(
  rpc: TestRpc,
  transaction: SignedTransaction,
  lastValidBlockHeight: bigint,
): Promise<Signature> {
  const transactionSignature = await rpc
    .sendTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  await confirmTransaction(rpc, transactionSignature, lastValidBlockHeight);
  return transactionSignature;
}

async function requestAndConfirmAirdrop(
  rpc: TestRpc,
  recipient: Address,
  lamports: bigint,
): Promise<void> {
  const transactionSignature = await rpc
    .requestAirdrop(recipient, lamportsAmount(lamports), { commitment: "confirmed" })
    .send();
  await confirmTransaction(rpc, transactionSignature);
}

export interface TestPlayer {
  player: KeyPairSigner;
  playerTokenAccount: Address;
}

export interface TestMint {
  mint: Address;
  mintAuthority: KeyPairSigner;
  gameVaultPDA: Address;
  tokenProgram: Address;
  decimals: number;
}

export interface TestGame {
  gamePDA: Address;
  randomHash: Uint8Array;
  secretKey: Uint8Array;
}

export interface OracleConfig {
  feePercentage: number;
  oracleBufferTime: number;
  maxTickets: number;
  maxTimeout: number;
  minTimeout: number;
}

export interface TestOracle {
  oraclePDA: Address;
  operator: Address;
  operatorKeypair: KeyPairSigner;
  config: OracleConfig;
}

export interface GameConfig {
  gameType: GameType;
  amount: bigint;
  maxTickets: number;
  minTickets: number;
  timeout: bigint;
  isPrivate: boolean;
}

export function coinflipGameConfig(
  overrides: Partial<Omit<GameConfig, "gameType">> = {},
): GameConfig {
  return {
    gameType: GameType.Coinflip,
    amount: 1_000_000n,
    maxTickets: 2,
    minTickets: 2,
    timeout: 3_600n,
    isPrivate: false,
    ...overrides,
  };
}

type StandardSetup = { oracle: TestOracle; mint: TestMint; players: TestPlayer[] };

export class TestEnvironment {
  private static instance: TestEnvironment;
  public readonly rpc = createSolanaRpc(rpcUrl()) as TestRpc;
  public payer!: KeyPairSigner;
  public oracle?: TestOracle;
  public globalMint?: TestMint;
  public playerPool: TestPlayer[] = [];

  private constructor() {}

  public static getInstance(): TestEnvironment {
    TestEnvironment.instance ??= new TestEnvironment();
    return TestEnvironment.instance;
  }

  async initialize(): Promise<StandardSetup> {
    if (this.oracle && this.globalMint && this.playerPool.length > 0) {
      return { oracle: this.oracle, mint: this.globalMint, players: this.playerPool };
    }
    this.payer = await loadPayer();
    const oracle = await new OracleManager(this).createOracle();
    const mintManager = new MintManager(this);
    const mint = await mintManager.createMint();
    const players = await new PlayerManager(this).createPlayerPool(8, mint.mint);
    for (const player of players) {
      await mintManager.mintTokensToAccount(
        mint,
        player.playerTokenAccount,
        DEFAULT_PLAYER_BALANCE,
      );
    }
    this.oracle = oracle;
    this.globalMint = mint;
    this.playerPool = players;
    return { oracle, mint, players };
  }
}

export async function deriveOraclePda(): Promise<Address> {
  return (await findOraclePda())[0];
}

export class OracleManager {
  constructor(private readonly env: TestEnvironment) {}

  async createOracle(config: Partial<OracleConfig> = {}): Promise<TestOracle> {
    const defaults: OracleConfig = {
      feePercentage: 1,
      oracleBufferTime: 2,
      maxTickets: 50_000,
      maxTimeout: 86_400,
      minTimeout: 1,
      ...config,
    };
    const oraclePDA = await deriveOraclePda();
    const operatorKeypair = await getDefaultOperatorKeypair();
    const existing = await fetchMaybeOracle(this.env.rpc, oraclePDA, { commitment: "confirmed" });
    if (existing.exists) {
      return {
        oraclePDA,
        operator: existing.data.operator,
        operatorKeypair,
        config: {
          feePercentage: existing.data.feePercentage,
          oracleBufferTime: Number(existing.data.oracleBufferTime),
          maxTickets: existing.data.maxTickets,
          maxTimeout: Number(existing.data.maxTimeout),
          minTimeout: Number(existing.data.minTimeout),
        },
      };
    }
    await requestAndConfirmAirdrop(this.env.rpc, this.env.payer.address, 5n * LAMPORTS_PER_SOL);
    await requestAndConfirmAirdrop(this.env.rpc, operatorKeypair.address, 5n * LAMPORTS_PER_SOL);
    const [programData] = await getProgramDerivedAddress({
      programAddress: UPGRADEABLE_LOADER_ADDRESS,
      seeds: [getAddressEncoder().encode(TIMBA_PROGRAM_ADDRESS)],
    });
    const instruction = await getInitializeOracleInstructionAsync({
      oracleOperator: operatorKeypair,
      upgradeAuthority: this.env.payer,
      programData,
      config: {
        feePercentage: defaults.feePercentage,
        oracleBufferTime: BigInt(defaults.oracleBufferTime),
        maxTickets: defaults.maxTickets,
        maxTimeout: BigInt(defaults.maxTimeout),
        minTimeout: BigInt(defaults.minTimeout),
      },
    });
    await sendInstructions(this.env.rpc, this.env.payer, [instruction]);
    return {
      oraclePDA,
      operator: operatorKeypair.address,
      operatorKeypair,
      config: defaults,
    };
  }
}

async function associatedTokenAddress(mint: Address, owner: Address): Promise<Address> {
  return (await findAssociatedTokenPda({ owner, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint }))[0];
}

async function ensureAssociatedTokenAccount(
  env: TestEnvironment,
  payer: KeyPairSigner,
  mint: Address,
  owner: Address,
): Promise<Address> {
  const ata = await associatedTokenAddress(mint, owner);
  const account = await fetchEncodedAccount(env.rpc, ata, { commitment: "confirmed" });
  if (!account.exists) {
    const instruction = await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer,
      ata,
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    await sendInstructions(env.rpc, payer, [instruction]);
  }
  return ata;
}

export async function ensureOperatorAta(
  env: TestEnvironment,
  oracle: TestOracle,
  mint: Address,
): Promise<Address> {
  return ensureAssociatedTokenAccount(env, oracle.operatorKeypair, mint, oracle.operator);
}

export class MintManager {
  constructor(private readonly env: TestEnvironment) {}

  async createMint(): Promise<TestMint> {
    const mintAuthority = await generateKeyPairSigner();
    await requestAndConfirmAirdrop(this.env.rpc, mintAuthority.address, 5n * LAMPORTS_PER_SOL);
    const mint = await generateKeyPairSigner();
    const plan = await getCreateMintInstructionPlan(
      createClientWithGetMinimumBalanceFromRpc(this.env.rpc),
      {
        payer: mintAuthority,
        newMint: mint,
        decimals: 6,
        mintAuthority: mintAuthority.address,
        freezeAuthority: null,
      },
    );
    const leaves = flattenInstructionPlan(plan);
    if (leaves.some((leaf) => leaf.kind !== "single")) {
      throw new Error("Mint instruction plan requires unsupported message packing");
    }
    const instructions = leaves.map((leaf) => (leaf as { instruction: Instruction }).instruction);
    await sendInstructions(this.env.rpc, mintAuthority, instructions);

    const [gameVaultPDA] = await findGameVaultPda({ tokenMint: mint.address });
    await ensureAssociatedTokenAccount(this.env, mintAuthority, mint.address, gameVaultPDA);
    await ensureAssociatedTokenAccount(
      this.env,
      mintAuthority,
      mint.address,
      this.env.payer.address,
    );
    const oracle = await fetchOracle(this.env.rpc, await deriveOraclePda(), {
      commitment: "confirmed",
    });
    await ensureAssociatedTokenAccount(this.env, mintAuthority, mint.address, oracle.data.operator);
    return {
      mint: mint.address,
      mintAuthority,
      gameVaultPDA,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      decimals: 6,
    };
  }

  async mintTokensToAccount(mint: TestMint, tokenAccount: Address, amount: bigint): Promise<void> {
    if (amount === 0n) return;
    const mintInfo = await fetchMint(this.env.rpc, mint.mint, { commitment: "confirmed" });
    const available = 0xffff_ffff_ffff_ffffn - mintInfo.data.supply;
    const mintAmount = amount <= available ? amount : available;
    if (mintAmount === 0n) return;
    await sendInstructions(this.env.rpc, mint.mintAuthority, [
      getMintToInstruction({
        mint: mint.mint,
        token: tokenAccount,
        mintAuthority: mint.mintAuthority,
        amount: mintAmount,
      }),
    ]);
  }
}

export class PlayerManager {
  constructor(private readonly env: TestEnvironment) {}

  async createPlayer(mint: Address): Promise<TestPlayer> {
    const player = await generateKeyPairSigner();
    await requestAndConfirmAirdrop(this.env.rpc, player.address, 3n * LAMPORTS_PER_SOL);
    const playerTokenAccount = await ensureAssociatedTokenAccount(
      this.env,
      player,
      mint,
      player.address,
    );
    return { player, playerTokenAccount };
  }

  async createPlayerPool(count: number, mint: Address): Promise<TestPlayer[]> {
    const players: TestPlayer[] = [];
    for (let index = 0; index < count; index += 1) {
      players.push(await this.createPlayer(mint));
    }
    return players;
  }
}

const gameVaultCache = new Map<string, Address>();

export type DerivedGameAccounts = {
  tokenMint: Address;
  oracle: Address;
  gameVault: Address;
  gameVaultTokenAccount: Address;
  playerTokenAccount?: Address;
  winnerTokenAccount?: Address;
};

export async function deriveGameAccounts(
  env: TestEnvironment,
  gamePDA: Address,
  options: { player?: Address; winner?: Address; tokenMint?: Address } = {},
): Promise<DerivedGameAccounts> {
  let tokenMint = options.tokenMint ?? gameVaultCache.get(gamePDA);
  if (!tokenMint) {
    tokenMint = (await fetchGame(env.rpc, gamePDA, { commitment: "confirmed" })).data.tokenMint;
  }
  gameVaultCache.set(gamePDA, tokenMint);
  const [oracle] = await findOraclePda();
  const [gameVault] = await findGameVaultPda({ tokenMint });
  const gameVaultTokenAccount = await associatedTokenAddress(tokenMint, gameVault);
  const playerTokenAccount = options.player
    ? await associatedTokenAddress(tokenMint, options.player)
    : undefined;
  const winnerTokenAccount = options.winner
    ? await associatedTokenAddress(tokenMint, options.winner)
    : undefined;
  return {
    tokenMint,
    oracle,
    gameVault,
    gameVaultTokenAccount,
    ...(playerTokenAccount ? { playerTokenAccount } : {}),
    ...(winnerTokenAccount ? { winnerTokenAccount } : {}),
  };
}

export type CompleteGameAccounts = {
  tokenMint: Address;
  gameVault: Address;
  gameVaultTokenAccount: Address;
  oracle: Address;
  winner: Address;
  creator: Address;
  winnerTokenAccount: Address;
  oracleOperatorTokenAccount: Address;
};

export class GameManager {
  constructor(private readonly env: TestEnvironment) {}

  async generateGamePDA(): Promise<TestGame> {
    const secretKey = crypto.getRandomValues(new Uint8Array(32));
    const randomHash = new Uint8Array(createHash("sha256").update(secretKey).digest());
    const [gamePDA] = await findGamePda({ randomHash });
    return { gamePDA, randomHash, secretKey };
  }

  async fetchGame(gamePDA: Address): Promise<Game> {
    return (await fetchGame(this.env.rpc, gamePDA, { commitment: "confirmed" })).data;
  }

  async createGame(
    config: GameConfig,
    creator: KeyPairSigner,
    tokenMint: Address,
  ): Promise<TestGame> {
    const gameData = await this.generateGamePDA();
    const creatorTokenAccount = await associatedTokenAddress(tokenMint, creator.address);
    const oracleOperator = this.env.oracle?.operatorKeypair ?? (await getDefaultOperatorKeypair());
    const instruction = await getInitializeGameInstructionAsync({
      creator,
      oracleOperator,
      tokenMint,
      creatorTokenAccount,
      gameType: config.gameType,
      amount: config.amount,
      maxTickets: config.maxTickets,
      minTickets: config.minTickets,
      timeout: config.timeout,
      isPrivate: config.isPrivate,
      randomHash: gameData.randomHash,
    });
    await sendInstructions(this.env.rpc, creator, [instruction]);
    gameVaultCache.set(gameData.gamePDA, tokenMint);
    return gameData;
  }

  async joinGame(
    gamePDA: Address,
    player: KeyPairSigner,
    oracleOperator?: KeyPairSigner,
  ): Promise<void> {
    const derived = await deriveGameAccounts(this.env, gamePDA, { player: player.address });
    if (!derived.playerTokenAccount) throw new Error("Missing player token account");
    const instruction = await getJoinGameInstructionAsync({
      game: gamePDA,
      player,
      ...(oracleOperator ? { oracleOperator } : {}),
      tokenMint: derived.tokenMint,
      gameVault: derived.gameVault,
      gameVaultTokenAccount: derived.gameVaultTokenAccount,
      playerTokenAccount: derived.playerTokenAccount,
      oracle: derived.oracle,
    });
    await sendInstructions(this.env.rpc, player, [instruction]);
  }

  async buildUnjoinGameInstruction(gamePDA: Address, player: KeyPairSigner) {
    const derived = await deriveGameAccounts(this.env, gamePDA, { player: player.address });
    if (!derived.playerTokenAccount) throw new Error("Missing player token account");
    return getUnjoinGameInstructionAsync({
      game: gamePDA,
      player: player.address,
      authority: player,
      oracle: derived.oracle,
      tokenMint: derived.tokenMint,
      gameVault: derived.gameVault,
      gameVaultTokenAccount: derived.gameVaultTokenAccount,
      playerTokenAccount: derived.playerTokenAccount,
    });
  }

  async buildCompleteGameInstruction(
    gameData: TestGame,
    winner: Address,
    creator: Address,
    oracleOperatorKeypair: KeyPairSigner,
    winnerIndex: number,
  ) {
    const accounts = await this.buildCompleteGameAccounts(
      gameData,
      winner,
      creator,
      oracleOperatorKeypair.address,
    );
    return getCompleteGameInstructionAsync({
      game: gameData.gamePDA,
      ...accounts,
      oracleOperator: oracleOperatorKeypair,
      randomHash: gameData.randomHash,
      secretKey: gameData.secretKey,
      winnerIndex,
    });
  }

  async completeGame(
    gameData: TestGame,
    winner: Address,
    creator: Address,
    oracleOperator: Address,
    winnerIndex: number,
    oracleOperatorKeypair?: KeyPairSigner,
  ): Promise<void> {
    const operatorSigner = oracleOperatorKeypair ?? (await getDefaultOperatorKeypair());
    if (operatorSigner.address !== oracleOperator) {
      throw new Error("Oracle operator signer does not match the requested operator");
    }
    const instruction = await this.buildCompleteGameInstruction(
      gameData,
      winner,
      creator,
      operatorSigner,
      winnerIndex,
    );
    await sendInstructions(this.env.rpc, operatorSigner, [instruction]);
  }

  async buildCompleteGameAccounts(
    gameData: TestGame,
    winner: Address,
    creator: Address,
    oracleOperator: Address,
  ): Promise<CompleteGameAccounts> {
    const derived = await deriveGameAccounts(this.env, gameData.gamePDA, { winner });
    if (!derived.winnerTokenAccount) throw new Error("Missing winner token account");
    return {
      tokenMint: derived.tokenMint,
      gameVault: derived.gameVault,
      gameVaultTokenAccount: derived.gameVaultTokenAccount,
      oracle: derived.oracle,
      winner,
      creator,
      winnerTokenAccount: derived.winnerTokenAccount,
      oracleOperatorTokenAccount: await associatedTokenAddress(derived.tokenMint, oracleOperator),
    };
  }
}

export class TestUtils {
  public readonly env = TestEnvironment.getInstance();
  public readonly oracle = new OracleManager(this.env);
  public readonly mint = new MintManager(this.env);
  public readonly player = new PlayerManager(this.env);
  public readonly game = new GameManager(this.env);

  async quickSetup(): Promise<StandardSetup> {
    const setup = await this.env.initialize();
    for (const player of setup.players) {
      const balance = (await fetchToken(this.env.rpc, player.playerTokenAccount)).data.amount;
      if (balance < DEFAULT_PLAYER_BALANCE) {
        await this.mint.mintTokensToAccount(
          setup.mint,
          player.playerTokenAccount,
          DEFAULT_PLAYER_BALANCE - balance,
        );
      }
    }
    return setup;
  }
}

type BufferReadyGameAccount = Pick<Game, "createdAt" | "timeout">;

export async function getClockUnixTimestamp(rpc: TestRpc): Promise<number> {
  const clock = await fetchEncodedAccount(rpc, CLOCK_SYSVAR_ADDRESS, { commitment: "confirmed" });
  if (!clock.exists) throw new Error("Clock sysvar account unavailable");
  return Number(
    new DataView(clock.data.buffer, clock.data.byteOffset + 32, 8).getBigInt64(0, true),
  );
}

async function tickClock(env: TestEnvironment): Promise<void> {
  await sendInstructions(env.rpc, env.payer, [
    getTransferSolInstruction({ source: env.payer, destination: env.payer.address, amount: 0n }),
  ]);
}

export async function awaitOracleCompletionReady(
  gameAccount: BufferReadyGameAccount,
  oracleConfig: OracleConfig,
  extraSlackSeconds = 0.5,
): Promise<void> {
  const env = TestEnvironment.getInstance();
  const boundedSlack =
    oracleConfig.oracleBufferTime > 0
      ? Math.min(extraSlackSeconds, Math.max(oracleConfig.oracleBufferTime - 0.25, 0))
      : 0;
  const targetTimestamp =
    Number(gameAccount.createdAt) + Number(gameAccount.timeout) + boundedSlack;
  let start = Date.now();
  let extended = false;
  let previousClockTimestamp: number | undefined;
  let stalledPolls = 0;
  while (true) {
    const clockTimestamp = await getClockUnixTimestamp(env.rpc);
    if (clockTimestamp >= targetTimestamp) return;
    if (clockTimestamp === previousClockTimestamp) {
      stalledPolls += 1;
      if (stalledPolls >= CLOCK_STALL_POLLS_BEFORE_TICK) {
        await tickClock(env);
        stalledPolls = 0;
      }
    } else {
      stalledPolls = 0;
    }
    previousClockTimestamp = clockTimestamp;
    if (Date.now() - start > DEFAULT_BUFFER_MAX_WAIT_MS) {
      if (extended) {
        throw new Error(
          `Timed out waiting for game timeout (target=${targetTimestamp}, clock=${clockTimestamp})`,
        );
      }
      extended = true;
      start = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_BUFFER_POLL_INTERVAL_MS));
  }
}

export function calculateWinnerIndex(
  ticketsCount: number,
  secretKey: ReadonlyUint8Array,
  lastSlot: number,
): number {
  if (ticketsCount === 1) return 0;
  const nPlayers = BigInt(ticketsCount);
  const combinedData = new Uint8Array(40);
  combinedData.set(secretKey, 0);
  new DataView(combinedData.buffer).setBigUint64(32, BigInt(lastSlot), true);
  const entropyHash = createHash("sha256").update(combinedData).digest();
  const maxU64 = 0xffff_ffff_ffff_ffffn;
  const maxValid = maxU64 - (maxU64 % nPlayers);
  for (let startPos = 0; startPos <= 24; startPos += 1) {
    const randomBytes = entropyHash.subarray(startPos, startPos + 8);
    const randomU64 = new DataView(
      randomBytes.buffer,
      randomBytes.byteOffset,
      randomBytes.byteLength,
    ).getBigUint64(0, true);
    if (randomU64 < maxValid) return Number(randomU64 % nPlayers);
  }
  throw new Error("Unable to generate unbiased random number");
}

export function getWinnerFromPlayers(players: TestPlayer[], winnerIndex: number): TestPlayer {
  const winner = players[winnerIndex];
  if (!winner) throw new Error(`Winner index ${winnerIndex} is out of bounds`);
  return winner;
}

export function calculatePayoutBreakdown(
  pot: bigint,
  feePercentage: number,
): { fee: bigint; winnerAmount: bigint } {
  const fee = (pot * BigInt(feePercentage)) / 100n;
  return { fee, winnerAmount: pot - fee };
}

const PROGRAM_ERROR_CODES: Record<number, string> = {
  7000: "UnauthorizedOperator",
  7001: "UnauthorizedPlayer",
  7002: "InvalidCreator",
  7100: "GameFull",
  7101: "GameWaitingForOracle",
  7102: "GameNotReadyForOracle",
  7103: "GameHasActivePlayers",
  7202: "WinnerIndexMismatch",
  7207: "ParticipantNotFound",
};

function getErrorCode(error: unknown): string | undefined {
  const message = errorToString(error);
  const hexMatch = /custom program error:\s*0x([0-9a-fA-F]+)/i.exec(message);
  if (hexMatch?.[1]) return PROGRAM_ERROR_CODES[Number.parseInt(hexMatch[1], 16)];
  const customMatch = /["']?Custom["']?\s*[:(]\s*["']?(\d+)/i.exec(message);
  if (customMatch?.[1]) return PROGRAM_ERROR_CODES[Number.parseInt(customMatch[1], 10)];
  for (const code of Object.values(PROGRAM_ERROR_CODES)) {
    if (message.includes(code)) return code;
  }
  return undefined;
}

export async function expectProgramError(
  promise: Promise<unknown>,
  code: string,
  { fallbackSubstring, message }: { fallbackSubstring?: string; message?: string } = {},
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caught = error;
  }
  if (caught === undefined) throw new Error(message ?? `Expected program error ${code}`);
  const actualCode = getErrorCode(caught);
  if (actualCode) {
    expect(actualCode).toBe(code);
    return;
  }
  const errorMessage = errorToString(caught);
  if (fallbackSubstring && errorMessage.includes(fallbackSubstring)) return;
  throw new Error(`Expected program error ${code} but received: ${errorMessage}`);
}

export async function fetchTokenBalance(rpc: TestRpc, tokenAccount: Address): Promise<bigint> {
  return (await fetchToken(rpc, tokenAccount, { commitment: "confirmed" })).data.amount;
}

export async function gameExists(rpc: TestRpc, game: Address): Promise<boolean> {
  return (await fetchMaybeGame(rpc, game, { commitment: "confirmed" })).exists;
}
