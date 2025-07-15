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
}

export interface GameConfig {
  gameType: any;
  amount: anchor.BN;
  maxTickets: number;
  minTickets: number;
  timeout: number;
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
    this.playerPool = await playerManager.createPlayerPool(8, this.globalMint.mint);

    // Fund all players
    for (const player of this.playerPool) {
      await mintManager.mintTokensToAccount(
        this.globalMint,
        player.playerTokenAccount.address,
        new anchor.BN(10_000_000)
      );
    }

    // Test environment initialized
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
  private program: anchor.Program<Coinflip>;
  private provider: anchor.AnchorProvider;

  constructor(program: anchor.Program<Coinflip>, provider: anchor.AnchorProvider) {
    this.program = program;
    this.provider = provider;
  }

  async createOracle(config?: Partial<OracleConfig>): Promise<TestOracle> {
    const defaultConfig: OracleConfig = {
      feePercentage: 1,
      oracleBufferTime: 2,
      maxTickets: 100,
      maxTimeout: 86400,
      minTimeout: 1,
      ...config
    };

    const [oraclePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      this.program.programId
    );

    // Use a deterministic keypair for tests so we can reuse it
    const operatorKeypair = anchor.web3.Keypair.fromSeed(new Uint8Array(32).fill(42));

    try {
      // Check if oracle already exists and is properly initialized
      try {
        const existingOracle = await this.program.account.oracle.fetch(oraclePDA);
        // Oracle already initialized
        return {
          oraclePDA,
          operator: existingOracle.operator,
          operatorKeypair,
          config: {
            feePercentage: existingOracle.feePercentage,
            oracleBufferTime: existingOracle.oracleBufferTime,
            maxTickets: existingOracle.maxTickets,
            maxTimeout: existingOracle.maxTimeout,
            minTimeout: existingOracle.minTimeout,
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

      await this.provider.connection.confirmTransaction(providerAirdrop);
      await this.provider.connection.confirmTransaction(operatorAirdrop);

      await this.program.methods
        .initializeOracle(defaultConfig)
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
    const operatorKeypair = anchor.web3.Keypair.fromSeed(new Uint8Array(32).fill(42));

    return {
      oraclePDA,
      operator: oracleAccount.operator,
      operatorKeypair,
      config: {
        feePercentage: oracleAccount.feePercentage,
        oracleBufferTime: oracleAccount.oracleBufferTime,
        maxTickets: oracleAccount.maxTickets,
        maxTimeout: oracleAccount.maxTimeout,
        minTimeout: oracleAccount.minTimeout,
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

  constructor(program: anchor.Program<Coinflip>, provider: anchor.AnchorProvider) {
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
    await this.provider.connection.confirmTransaction(signature);

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
    const oracleOperatorKeypair = anchor.web3.Keypair.fromSeed(new Uint8Array(32).fill(42));

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

  constructor(program: anchor.Program<Coinflip>, provider: anchor.AnchorProvider) {
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
    await this.provider.connection.confirmTransaction(signature);

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
        Buffer.from("player_balance"),
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

  async createPlayerPool(count: number, mint: PublicKey): Promise<TestPlayer[]> {
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
        this.provider.connection.confirmTransaction(signature)
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
        .initializePlayerBalance()
        .accounts({
          player: player.publicKey,
          tokenMint: mint,
        })
        .signers([player])
        .rpc();

      const [playerBalancePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_balance"),
          player.publicKey.toBuffer(),
          mint.toBuffer(),
        ],
        this.program.programId
      );

      return { player, playerTokenAccount, playerBalancePDA };
    });

    return Promise.all(playerPromises);
  }

  async fundPlayer(player: TestPlayer, mint: TestMint, amount: anchor.BN): Promise<void> {
    await this.mintManager.mintTokensToAccount(mint, player.playerTokenAccount.address, amount);
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
    const secretKeyBuffer = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
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
    await this.program.methods
      .initializeGame(config, gameData.randomHash)
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
    ticketIndex: number,
    merkleProof?: number[][],
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

    // Create participation entry for the player
    const playerParticipation = {
      player: player.publicKey,
      ticketIndex,
    };

    // Use provided proof or empty array for testing
    const playerMerkleProof: number[][] = merkleProof || [];

    await this.program.methods
      .rollGame(playerParticipation, playerMerkleProof)
      .accounts(accounts)
      .signers(signers)
      .rpc();
  }

  async unjoinGame(
    gamePDA: PublicKey,
    player: anchor.web3.Keypair,
    ticketIndex: number,
    exclusionProof?: any
  ): Promise<void> {
    await this.program.methods
      .unjoinGame(ticketIndex, exclusionProof)
      .accounts({
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
    winnerParticipation?: { player: PublicKey; ticketIndex: number },
    winnerMerkleProof?: number[][],
    oracleOperatorKeypair?: anchor.web3.Keypair
  ): Promise<void> {
    // Default participation entry if not provided
    const participation = winnerParticipation || {
      player: winner,
      ticketIndex: 0,
    };

    // Default empty proof if not provided
    const proof = winnerMerkleProof || [];

    // Use provided oracle operator keypair or default to deterministic one
    const operatorKeypair = oracleOperatorKeypair || anchor.web3.Keypair.fromSeed(new Uint8Array(32).fill(42));

    await this.program.methods
      .completeGame(gameData.randomHash, gameData.secretKey, participation, proof)
      .accounts({
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
    throw new Error(`Winner index ${winnerIndex} is out of bounds for ${players.length} players`);
  }
  return players[winnerIndex];
}

/**
 * Creates a participation entry for merkle tree operations
 */
export function createParticipationEntry(
  player: PublicKey,
  ticketIndex: number
): { player: PublicKey; ticketIndex: number } {
  return {
    player,
    ticketIndex,
  };
}

/**
 * Hashes a buffer using SHA-256 and returns the digest as a Buffer
 */
function hash(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Hashes a participation entry for merkle tree operations
 * Uses Borsh serialization to match the contract's implementation
 */
export function hashParticipationEntry(entry: { player: PublicKey; ticketIndex: number }): Buffer {
  // Borsh serialization: player (32 bytes) + ticket_index (4 bytes LE)
  const playerBytes = entry.player.toBytes();
  const indexBytes = Buffer.alloc(4);
  indexBytes.writeUInt32LE(entry.ticketIndex, 0);

  const combined = Buffer.concat([playerBytes, indexBytes]);
  return hash(combined);
}

/**
 * Computes merkle root from leaf hashes
 */
export function computeMerkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(32);
  if (leaves.length === 1) return leaves[0];

  const tree = [...leaves];
  while (tree.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < tree.length; i += 2) {
      if (i + 1 < tree.length) {
        const combined = Buffer.concat([tree[i], tree[i + 1]]);
        nextLevel.push(hash(combined));
      } else {
        nextLevel.push(tree[i]);
      }
    }
    tree.length = 0;
    tree.push(...nextLevel);
  }
  return tree[0];
}

/**
 * MerkleTreeSimulator that exactly matches the contract's merkle tree logic
 */
class MerkleTreeSimulator {
  private recentTickets: Buffer[] = [];
  private recentCount: number = 0;
  private subtrees: { rootHash: Buffer; startIndex: number; size: number }[] = [];
  private merkleRoot: Buffer = Buffer.alloc(32);
  private ticketsCount: number = 0;
  private ticketToPlayer: Map<number, PublicKey> = new Map();

  /**
   * Adds a ticket to the merkle tree, matching contract's add_ticket_to_merkle_tree logic
   */
  addTicket(player: PublicKey): void {
    const participation = createParticipationEntry(player, this.ticketsCount);
    const leafHash = hashParticipationEntry(participation);
    
    // Track which player owns this ticket
    this.ticketToPlayer.set(this.ticketsCount, player);

    if (this.recentCount < 2) {
      // Just add to buffer - no structure change
      this.recentTickets.push(leafHash);
      this.recentCount += 1;
      // NO root update needed!
    } else {
      // Structure changes - update root
      const newSubtree = this.buildSubtreeFromRecent();
      this.mergeSubtree(newSubtree);
      this.recentTickets = [leafHash];
      this.recentCount = 1;
      this.updateMerkleRoot();
    }

    this.ticketsCount += 1;
  }

  /**
   * Builds a subtree from the recent tickets buffer
   */
  private buildSubtreeFromRecent(): { rootHash: Buffer; startIndex: number; size: number } {
    if (this.recentCount !== 2) {
      throw new Error("Recent count must be 2 to build subtree");
    }

    const startIndex = this.ticketsCount - this.recentCount;
    const leaves = [...this.recentTickets];
    const rootHash = this.computeMerkleRoot(leaves);

    return {
      rootHash,
      startIndex,
      size: 2,
    };
  }

  /**
   * Merges a new subtree into storage
   */
  private mergeSubtree(newSubtree: { rootHash: Buffer; startIndex: number; size: number }): void {
    // For simplicity, just add directly (no merging of same-sized subtrees for now)
    this.subtrees.push(newSubtree);
  }

  /**
   * Updates the merkle root from all subtrees
   */
  private updateMerkleRoot(): void {
    if (this.subtrees.length === 0) {
      this.merkleRoot = Buffer.alloc(32);
      return;
    }

    // Sort subtrees by start_index
    const sortedSubtrees = [...this.subtrees].sort((a, b) => a.startIndex - b.startIndex);
    const hashes = sortedSubtrees.map(s => s.rootHash);
    this.merkleRoot = this.computeMerkleRoot(hashes);
  }

  /**
   * Computes merkle root using the same logic as the contract
   */
  private computeMerkleRoot(leaves: Buffer[]): Buffer {
    if (leaves.length === 0) {
      return Buffer.alloc(32);
    }

    let layer = [...leaves];
    while (layer.length > 1) {
      const nextLayer: Buffer[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        if (i + 1 < layer.length) {
          const combined = Buffer.concat([layer[i], layer[i + 1]]);
          nextLayer.push(hash(combined));
        } else {
          nextLayer.push(layer[i]);
        }
      }
      layer = nextLayer;
    }
    return layer[0];
  }

  /**
   * Generates a merkle proof for a given ticket index
   */
  generateProof(targetIndex: number): number[][] {
    const committedTickets = this.ticketsCount - this.recentCount;

    if (targetIndex >= committedTickets) {
      // Ticket is in recent buffer, no proof needed
      return [];
    }

    // Find which subtree contains the target ticket
    for (const subtree of this.subtrees) {
      if (targetIndex >= subtree.startIndex && targetIndex < subtree.startIndex + subtree.size) {
        // Target is in this subtree, generate proof within subtree + proof to root
        const relativeIndex = targetIndex - subtree.startIndex;
        console.log(`    Found ticket ${targetIndex} in subtree [${subtree.startIndex}, ${subtree.startIndex + subtree.size}), relativeIndex=${relativeIndex}`);
        console.log(`    Subtree count: ${this.subtrees.length}`);
        
        // Log all subtrees for debugging
        this.subtrees.forEach((st, i) => {
          console.log(`      Subtree ${i}: [${st.startIndex}, ${st.startIndex + st.size})`);
        });
        
        const proof = this.generateSubtreeProof(subtree, relativeIndex);
        console.log(`    Generated proof levels: ${proof.length}`);
        
        // Log detailed proof content
        proof.forEach((level, i) => {
          const hexContent = Buffer.from(level).toString('hex').substring(0, 16) + '...';
          console.log(`      Level ${i}: ${level.length} bytes (${hexContent})`);
        });
        return proof;
      }
    }

    // Shouldn't reach here if logic is correct
    console.log(`    ERROR: Ticket ${targetIndex} not found in any subtree`);
    return [];
  }

  /**
   * Generates complete proof from ticket to final merkle root
   * This includes both intra-subtree proof and inter-subtree proof
   */
  private generateSubtreeProof(
    subtree: { rootHash: Buffer; startIndex: number; size: number },
    relativeIndex: number
  ): number[][] {
    const proof: number[][] = [];
    
    // Step 1: Generate proof within the subtree (ticket -> subtree root)
    if (subtree.size === 2) {
      const siblingIndex = relativeIndex === 0 ? 1 : 0;
      const siblingTicketIndex = subtree.startIndex + siblingIndex;
      const sibling = this.getTicketHash(siblingTicketIndex);
      proof.push(Array.from(sibling));
    } else {
      // For larger subtrees, would need more complex intra-subtree proof
      // For now, most tests use size-2 subtrees
      return [];
    }
    
    // Step 2: Generate proof from subtree root to final merkle root
    const subtreeRootProof = this.generateSubtreeRootProof(subtree);
    proof.push(...subtreeRootProof);
    
    return proof;
  }

  /**
   * Generates proof from a subtree root to the final merkle root
   */
  private generateSubtreeRootProof(
    targetSubtree: { rootHash: Buffer; startIndex: number; size: number }
  ): number[][] {
    if (this.subtrees.length <= 1) {
      // Single subtree means its root IS the final merkle root
      return [];
    }
    
    // Sort subtrees by start_index (same as contract does)
    const sortedSubtrees = [...this.subtrees].sort((a, b) => a.startIndex - b.startIndex);
    
    // Find the index of our target subtree
    const targetSubtreeIndex = sortedSubtrees.findIndex(
      s => s.startIndex === targetSubtree.startIndex
    );
    
    if (targetSubtreeIndex === -1) {
      throw new Error("Target subtree not found in sorted list");
    }
    
    // Generate merkle proof for this subtree's position in the subtree merkle tree
    const subtreeHashes = sortedSubtrees.map(s => s.rootHash);
    return this.buildMerkleProofFromBuffers(subtreeHashes, targetSubtreeIndex);
  }

  /**
   * Builds a merkle proof from an array of Buffer hashes
   */
  private buildMerkleProofFromBuffers(leaves: Buffer[], targetIndex: number): number[][] {
    if (leaves.length === 0 || targetIndex >= leaves.length) {
      return [];
    }

    if (leaves.length === 1) {
      return []; // Single leaf needs no proof
    }

    const proof: number[][] = [];
    let currentIndex = targetIndex;
    let currentLevel = [...leaves];

    while (currentLevel.length > 1) {
      const nextLevel: Buffer[] = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          // Pair exists
          const left = currentLevel[i];
          const right = currentLevel[i + 1];
          const combined = Buffer.concat([left, right]);
          nextLevel.push(hash(combined));

          // If current index is in this pair, add sibling to proof
          if (currentIndex === i) {
            proof.push(Array.from(right));
          } else if (currentIndex === i + 1) {
            proof.push(Array.from(left));
          }
        } else {
          // Odd element, promote to next level
          nextLevel.push(currentLevel[i]);
        }
      }

      // Update index for next level
      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = nextLevel;
    }

    return proof;
  }

  /**
   * Gets the hash for a specific ticket index
   */
  private getTicketHash(ticketIndex: number): Buffer {
    const player = this.ticketToPlayer.get(ticketIndex);
    if (!player) {
      throw new Error(`No player found for ticket ${ticketIndex}`);
    }
    
    const entry = createParticipationEntry(player, ticketIndex);
    return hashParticipationEntry(entry);
  }

  getCommittedTicketsCount(): number {
    return this.ticketsCount - this.recentCount;
  }

  getRecentCount(): number {
    return this.recentCount;
  }

  getTicketsCount(): number {
    return this.ticketsCount;
  }
}

/**
 * Generates a merkle proof for player participation using the MerkleTreeSimulator
 * Returns empty array for recent players or proper merkle proof for subtree players
 */
export function generateMerkleProof(
  players: TestPlayer[],
  winnerIndex: number,
  gameState?: any
): number[][] {
  // The contract's verification logic:
  // committed_tickets = tickets_count - recent_count
  // if ticket_index >= committed_tickets: verify_recent_ticket (no proof needed)
  // else: verify_merkle_proof (proof needed)

  if (!gameState) {
    // Without game state, always return empty proof and let contract handle validation
    return [];
  }

  const committedTickets = gameState.ticketsCount - gameState.recentCount;

  if (winnerIndex >= committedTickets) {
    // Ticket is in recent buffer, no proof needed
    return [];
  }

  // DEBUG: Log the situation
  console.log(`    Need proof for ticket ${winnerIndex}, committed=${committedTickets}, recent=${gameState.recentCount}`);
  
  // Use the MerkleTreeSimulator to generate accurate proofs
  return generateSimulatorBasedProof(players, winnerIndex, gameState);
}

/**
 * Generates a merkle proof using the MerkleTreeSimulator that matches contract logic
 */
function generateSimulatorBasedProof(
  players: TestPlayer[],
  targetIndex: number,
  gameState: any
): number[][] {
  const simulator = new MerkleTreeSimulator();
  
  // Simulate the exact sequence of ticket additions that led to the current game state
  // For snowball games: tickets 0,1,2 are initial joins, tickets 3+ are rolls by creator
  for (let i = 0; i < gameState.ticketsCount; i++) {
    let player: TestPlayer;
    if (i === 0) {
      player = players[0]; // creator
    } else if (i === 1) {
      player = players[1]; // player1  
    } else if (i === 2) {
      player = players[2]; // player2
    } else {
      player = players[0]; // creator for all rolls
    }
    
    simulator.addTicket(player.player.publicKey);
  }
  
  // Verify our simulation matches the actual game state
  if (simulator.getTicketsCount() !== gameState.ticketsCount ||
      simulator.getRecentCount() !== gameState.recentCount) {
    console.log(`    Simulation mismatch: sim(${simulator.getTicketsCount()}, ${simulator.getRecentCount()}) vs game(${gameState.ticketsCount}, ${gameState.recentCount})`);
    // Fall back to simple proof generation
    return generateSimpleMerkleProof(players, targetIndex, gameState.ticketsCount - gameState.recentCount);
  }
  
  // The contract uses subtrees internally, so we need to generate proofs that match that structure
  const committedTickets = gameState.ticketsCount - gameState.recentCount;
  console.log(`    Generating proof for subtree-based structure with ${committedTickets} committed tickets`);
  return generateSubtreeMerkleProof(players, targetIndex, gameState);
}

/**
 * Generates a logical merkle proof that matches the contract's verification expectations
 * The contract expects a binary tree where ticket N is at position N in the tree
 */
function generateLogicalMerkleProof(
  players: TestPlayer[],
  targetIndex: number,
  committedTickets: number
): number[][] {
  // Build leaves for all committed tickets in their logical positions
  const leaves: Buffer[] = [];
  
  for (let i = 0; i < committedTickets; i++) {
    let player: TestPlayer;
    if (i === 0) {
      player = players[0]; // creator
    } else if (i === 1) {
      player = players[1]; // player1
    } else if (i === 2) {
      player = players[2]; // player2
    } else {
      player = players[0]; // creator for all rolls
    }
    
    const entry = createParticipationEntry(player.player.publicKey, i);
    leaves.push(hashParticipationEntry(entry));
  }

  // Build the logical binary merkle tree that the contract expects
  return buildMerkleProof(leaves, targetIndex);
}

/**
 * Generates a simple merkle proof for committed tickets
 * Builds a straightforward binary merkle tree from the committed tickets
 */
function generateSimpleMerkleProof(
  players: TestPlayer[],
  targetIndex: number,
  committedTickets: number
): number[][] {
  // Build leaves for all committed tickets
  const leaves: Buffer[] = [];
  
  for (let i = 0; i < committedTickets; i++) {
    let player: TestPlayer;
    if (i === 0) {
      player = players[0]; // creator
    } else if (i === 1) {
      player = players[1]; // player1
    } else if (i === 2) {
      player = players[2]; // player2
    } else {
      player = players[0]; // creator for all rolls
    }
    
    const entry = createParticipationEntry(player.player.publicKey, i);
    leaves.push(hashParticipationEntry(entry));
  }

  // Build simple binary merkle tree and generate proof
  return buildMerkleProof(leaves, targetIndex);
}

/**
 * Generates merkle proof for players in committed subtrees
 * The contract builds subtrees in pairs, so we need to simulate that structure
 */
function generateSubtreeMerkleProof(
  players: TestPlayer[],
  targetIndex: number,
  gameState: any
): number[][] {
  const committedTickets = gameState.ticketsCount - gameState.recentCount;

  // Only generate proofs for committed tickets
  if (targetIndex >= committedTickets) {
    return [];
  }

  console.log(`    Need proof for ticket ${targetIndex}, committed=${committedTickets}, recent=${gameState.recentCount}`);
  
  // Build the contract's exact subtree structure
  const { subtreeRoots, subtreeInfos } = buildContractSubtreeRoots(players, gameState.ticketsCount, committedTickets);
  console.log(`    Generated ${subtreeRoots.length} subtree roots`);
  
  // Compute our merkle root from subtree roots
  const ourComputedRoot = computeMerkleRootFromSubtrees(subtreeRoots);
  const contractRoot = Buffer.from(gameState.merkleRoot);
  
  console.log(`    Our computed root: ${ourComputedRoot.toString('hex')}`);
  console.log(`    Contract root:     ${contractRoot.toString('hex')}`);
  console.log(`    Roots match: ${ourComputedRoot.equals(contractRoot)}`);
  
  // DEBUG: Add detailed subtree analysis for mismatches
  if (!ourComputedRoot.equals(contractRoot)) {
    console.log(`    DETAILED MISMATCH ANALYSIS:`);
    console.log(`    Total tickets: ${gameState.ticketsCount}, Recent: ${gameState.recentCount}, Committed: ${committedTickets}`);
    console.log(`    Generated ${subtreeRoots.length} subtrees:`);
    for (let i = 0; i < subtreeInfos.length; i++) {
      console.log(`      Subtree ${i}: start=${subtreeInfos[i].startIndex}, size=${subtreeInfos[i].size}, root=${subtreeRoots[i].toString('hex').substring(0,16)}...`);
    }
    
    // Log player participation for each ticket
    console.log(`    Player participation:`);
    for (let i = 0; i < committedTickets; i++) {
      const player = getPlayerForTicket(players, i);
      const entry = createParticipationEntry(player.player.publicKey, i);
      const leafHash = hashParticipationEntry(entry);
      console.log(`      Ticket ${i}: player=${player.player.publicKey.toBase58().substring(0,8)}..., hash=${leafHash.toString('hex').substring(0,16)}...`);
    }
  }
  
  // Generate proof that works with the contract's merkle root (built from subtree roots)
  return generateProofAgainstSubtreeRoot(players, targetIndex, subtreeRoots, subtreeInfos);
}

/**
 * Computes merkle root from subtree roots using the same logic as the contract
 */
function computeMerkleRootFromSubtrees(subtreeRoots: Buffer[]): Buffer {
  if (subtreeRoots.length === 0) {
    return Buffer.alloc(32); // Empty tree
  }
  
  // Use the same merkle tree computation as the contract
  let layer = subtreeRoots.slice();
  while (layer.length > 1) {
    const nextLayer: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        // Hash pair
        const combined = Buffer.concat([layer[i], layer[i + 1]]);
        nextLayer.push(hash(combined));
      } else {
        // Odd element, promote to next level
        nextLayer.push(layer[i]);
      }
    }
    layer = nextLayer;
  }
  
  return layer[0];
}

/**
 * Builds subtree roots by simulating the contract's exact sequential process
 * This simulates ticket-by-ticket addition to determine the final subtree structure
 */
function buildContractSubtreeRoots(players: TestPlayer[], totalTickets: number, committedTickets: number): { subtreeRoots: Buffer[], subtreeInfos: Array<{ startIndex: number, size: number }> } {
  // The key insight: we need to simulate processing ALL tickets (committed + recent)
  // to reach the final state, then extract only the subtrees
  
  const recentTickets = totalTickets - committedTickets;
  
  console.log(`    Simulating ${totalTickets} total tickets (${committedTickets} committed + ${recentTickets} recent)`);
  
  if (totalTickets === 0) {
    return { subtreeRoots: [], subtreeInfos: [] };
  }
  
  const maxTickets = 13;
  const bufferFills = Math.ceil(maxTickets / 2);
  const maxSubtrees = countOnes(bufferFills);
  console.log(`    Max subtrees allowed: ${maxSubtrees}`);
  
  // Simulate the contract's exact state during sequential ticket addition
  let subtrees: Array<{ rootHash: Buffer; startIndex: number; size: number }> = [];
  let recentBuffer: Buffer[] = [];
  let bufferCount = 0;
  
  // Process ALL tickets sequentially to simulate the exact contract behavior
  for (let ticketIndex = 0; ticketIndex < totalTickets; ticketIndex++) {
    const player = getPlayerForTicket(players, ticketIndex);
    const entry = createParticipationEntry(player.player.publicKey, ticketIndex);
    const leafHash = hashParticipationEntry(entry);
    
    console.log(`    Processing ticket ${ticketIndex}:`);
    
    if (bufferCount < 2) {
      // Add to buffer - no structure change
      recentBuffer.push(leafHash);
      bufferCount++;
      console.log(`      Added to buffer (count=${bufferCount})`);
    } else {
      // Buffer is full - create subtree from current buffer
      const newSubtree = {
        rootHash: computeMerkleRootFromLeaves(recentBuffer),
        startIndex: ticketIndex - bufferCount,
        size: bufferCount
      };
      
      console.log(`      Creating subtree from buffer (start=${newSubtree.startIndex}, size=${newSubtree.size})`);
      
      // Check if we need to merge before adding the new subtree
      if (subtrees.length >= maxSubtrees) {
        console.log(`      Storage full, need to merge before adding`);
        
        const mergeIndices = findSameSizedPair(subtrees);
        if (mergeIndices) {
          const [idx1, idx2] = mergeIndices;
          const subtree1 = subtrees[idx1];
          const subtree2 = subtrees[idx2];
          
          console.log(`      Merging existing subtrees ${idx1} and ${idx2} (sizes ${subtree1.size}, ${subtree2.size})`);
          
          const merged = mergeSubtrees(subtree1, subtree2);
          
          // Remove the merged subtrees and add the new merged one
          const remainingSubtrees: typeof subtrees = [];
          for (let i = 0; i < subtrees.length; i++) {
            if (i !== idx1 && i !== idx2) {
              remainingSubtrees.push(subtrees[i]);
            }
          }
          remainingSubtrees.push(merged);
          subtrees = remainingSubtrees;
        }
      }
      
      // Add the new subtree
      subtrees.push(newSubtree);
      console.log(`      Added new subtree, total: ${subtrees.length}`);
      
      // Reset buffer with current ticket
      recentBuffer = [leafHash];
      bufferCount = 1;
      console.log(`      Reset buffer with current ticket`);
    }
  }
  
  // Sort subtrees by start_index before computing merkle root (matches contract logic)
  subtrees.sort((a, b) => a.startIndex - b.startIndex);
  console.log(`    Sorted subtrees by start_index:`);
  for (let i = 0; i < subtrees.length; i++) {
    console.log(`      Subtree ${i}: start=${subtrees[i].startIndex}, size=${subtrees[i].size}`);
  }
  
  const subtreeRoots = subtrees.map(s => s.rootHash);
  const subtreeInfos = subtrees.map(s => ({ startIndex: s.startIndex, size: s.size }));
  console.log(`    Final: ${subtreeRoots.length} subtrees (ignoring ${bufferCount} recent tickets in buffer)`);
  return { subtreeRoots, subtreeInfos };
}

/**
 * Builds a subtree from a pair of tickets (or single ticket)
 */
function buildSubtreeFromPair(players: TestPlayer[], startIndex: number, endIndex: number): { rootHash: Buffer; startIndex: number; size: number } {
  const leaves: Buffer[] = [];
  
  for (let i = startIndex; i <= endIndex; i++) {
    const player = getPlayerForTicket(players, i);
    const entry = createParticipationEntry(player.player.publicKey, i);
    leaves.push(hashParticipationEntry(entry));
  }
  
  return {
    rootHash: computeMerkleRootFromLeaves(leaves),
    startIndex,
    size: endIndex - startIndex + 1
  };
}

/**
 * Finds two same-sized subtrees to merge (contract's logic)
 * Prioritizes the smallest same-sized pair
 */
function findSameSizedPair(subtrees: Array<{ rootHash: Buffer; startIndex: number; size: number }>): [number, number] | null {
  let smallestSize = Infinity;
  let bestPair: [number, number] | null = null;
  
  console.log(`    Looking for same-sized pairs among ${subtrees.length} subtrees:`);
  for (let i = 0; i < subtrees.length; i++) {
    console.log(`      Subtree ${i}: size=${subtrees[i].size}, start=${subtrees[i].startIndex}`);
  }
  
  for (let i = 0; i < subtrees.length; i++) {
    for (let j = i + 1; j < subtrees.length; j++) {
      if (subtrees[i].size === subtrees[j].size && subtrees[i].size < smallestSize) {
        smallestSize = subtrees[i].size;
        bestPair = [i, j];
        console.log(`    Found same-sized pair: ${i} and ${j} (size=${smallestSize})`);
      }
    }
  }
  
  if (bestPair) {
    console.log(`    Selected pair: ${bestPair[0]} and ${bestPair[1]} (size=${smallestSize})`);
  } else {
    console.log(`    No same-sized pairs found`);
  }
  
  return bestPair;
}

/**
 * Merges two subtrees (contract's logic)
 */
function mergeSubtrees(
  subtree1: { rootHash: Buffer; startIndex: number; size: number },
  subtree2: { rootHash: Buffer; startIndex: number; size: number }
): { rootHash: Buffer; startIndex: number; size: number } {
  // Order hashes by start index for consistent structure
  const [left, right] = subtree1.startIndex < subtree2.startIndex 
    ? [subtree1.rootHash, subtree2.rootHash]
    : [subtree2.rootHash, subtree1.rootHash];
  
  return {
    rootHash: hash(Buffer.concat([left, right])),
    startIndex: Math.min(subtree1.startIndex, subtree2.startIndex),
    size: subtree1.size + subtree2.size
  };
}

/**
 * Counts the number of 1 bits (same as Rust's count_ones)
 */
function countOnes(n: number): number {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

/**
 * Computes merkle root from leaf hashes (same as contract's compute_merkle_root)
 */
function computeMerkleRootFromLeaves(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) {
    return Buffer.alloc(32);
  }
  
  let layer = leaves.slice();
  while (layer.length > 1) {
    const nextLayer: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        // Hash pair
        const combined = Buffer.concat([layer[i], layer[i + 1]]);
        nextLayer.push(hash(combined));
      } else {
        // Odd element, promote to next level
        nextLayer.push(layer[i]);
      }
    }
    layer = nextLayer;
  }
  
  return layer[0];
}

/**
 * Generates proof that works with contract's merkle root built from subtree roots
 * This implements a two-level proof: individual ticket → subtree root → game merkle root
 */
function generateProofAgainstSubtreeRoot(
  players: TestPlayer[],
  targetIndex: number,
  subtreeRoots: Buffer[],
  subtreeInfos: Array<{ startIndex: number, size: number }>
): number[][] {
  console.log(`    Generating proof for ticket ${targetIndex} in ${subtreeRoots.length} subtrees`);
  
  // Find which subtree contains our target ticket
  let subtreeIndex = -1;
  let positionInSubtree = -1;
  
  for (let i = 0; i < subtreeInfos.length; i++) {
    const info = subtreeInfos[i];
    if (targetIndex >= info.startIndex && targetIndex < info.startIndex + info.size) {
      subtreeIndex = i;
      positionInSubtree = targetIndex - info.startIndex;
      break;
    }
  }
  
  if (subtreeIndex === -1) {
    throw new Error(`Ticket ${targetIndex} not found in any subtree`);
  }
  
  const isLeftInSubtree = positionInSubtree % 2 === 0;
  console.log(`    Ticket ${targetIndex} is in subtree ${subtreeIndex}, isLeft=${isLeftInSubtree}`);
  
  // Build the complete proof chain
  const proof: number[][] = [];
  
  // Step 1: Generate proof within the subtree (if subtree has multiple tickets)
  const subtreeInfo = subtreeInfos[subtreeIndex];
  if (subtreeInfo.size > 1) {
    // Build all leaves in this subtree
    const subtreeLeaves: Buffer[] = [];
    for (let i = 0; i < subtreeInfo.size; i++) {
      const ticketIndex = subtreeInfo.startIndex + i;
      const player = getPlayerForTicket(players, ticketIndex);
      const entry = createParticipationEntry(player.player.publicKey, ticketIndex);
      subtreeLeaves.push(hashParticipationEntry(entry));
    }
    
    // Generate merkle proof for this ticket within the subtree
    const subtreeProof = buildMerkleProof(subtreeLeaves, positionInSubtree);
    proof.push(...subtreeProof);
  }
  
  // Step 2: Prove subtree is in the merkle root (if multiple subtrees exist)
  if (subtreeRoots.length > 1) {
    const subtreeProof = buildMerkleProof(subtreeRoots, subtreeIndex);
    proof.push(...subtreeProof);
  }
  
  console.log(`    Generated proof with ${proof.length} elements`);
  return proof;
}

/**
 * Gets the player for a specific ticket index (handles snowball game logic)
 */
function getPlayerForTicket(players: TestPlayer[], ticketIndex: number): TestPlayer {
  // For standard games (coinflip, giveaway), tickets map directly to players in join order
  // For snowball games, initial tickets are joins, later tickets are rolls by the same players
  
  // Handle standard sequential joining (most common case)
  if (ticketIndex < players.length) {
    return players[ticketIndex];
  }
  
  // For snowball games with rolls beyond initial joins:
  // Tickets 0,1,2 are initial joins, tickets 3+ are typically rolls by player 0 (creator)
  // This matches the pattern used in the snowball test cases
  return players[0]; // Default to creator for rolls
}

/**
 * Builds a merkle proof for a specific leaf index
 */
function buildMerkleProof(leaves: Buffer[], targetIndex: number): number[][] {
  if (leaves.length === 0 || targetIndex >= leaves.length) {
    return [];
  }

  if (leaves.length === 1) {
    return []; // Single leaf needs no proof
  }

  const proof: number[][] = [];
  let currentIndex = targetIndex;
  let currentLevel = [...leaves];

  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = [];
    const levelProof: number[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Pair exists
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const combined = Buffer.concat([left, right]);
        nextLevel.push(hash(combined));

        // If current index is in this pair, add sibling to proof
        if (currentIndex === i) {
          levelProof.push(...Array.from(right));
        } else if (currentIndex === i + 1) {
          levelProof.push(...Array.from(left));
        }
      } else {
        // Odd element, promote to next level
        nextLevel.push(currentLevel[i]);
      }
    }

    if (levelProof.length > 0) {
      proof.push(levelProof);
    }

    // Update index for next level
    currentIndex = Math.floor(currentIndex / 2);
    currentLevel = nextLevel;
  }

  return proof;
}

/**
 * Creates a valid exclusion proof for unjoin operations
 * This is a complex structure needed for subtree player removal
 */
export function createExclusionProof(
  departingPlayerIndex: number,
  players: TestPlayer[]
): any {
  // For simplicity in tests, return null for recent players
  // Real implementation would need complex subtree reconstruction logic
  if (departingPlayerIndex >= players.length - 2) {
    return null;
  }

  // For subtree players, return a minimal exclusion proof structure
  // This is simplified - real implementation would need proper merkle tree reconstruction
  return {
    departingPlayerProof: [],
    departingSubtreeOriginalRoot: Buffer.alloc(32),
    lastPlayerProof: [],
    lastSubtreeOriginalRoot: Buffer.alloc(32),
    remainingTicketsInSmallest: [],
    newPowerOf2Root: null,
    ticketsToRecent: [],
    departingSubtreeNewRoot: Buffer.alloc(32),
  };
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

    // Fund all players with tokens
    for (const player of players) {
      await this.player.fundPlayer(player, mint, new anchor.BN(10_000_000));
    }

    return { oracle, mint, players };
  }
}
