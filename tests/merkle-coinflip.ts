import * as anchor from "@coral-xyz/anchor";
import { Coinflip } from "../target/types/coinflip";
import { expect } from "chai";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import {
  hashParticipationEntry,
  buildMerkleTree,
  addEntryToTree,
  createParticipationEntry,
  verifyMerkleProof,
  hashNodes,
} from "./merkle-helpers";

/**
 * Updated tests for the merkle tree-based coinflip system
 */

describe("coinflip-merkle", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Coinflip as anchor.Program<Coinflip>;

  // Global test state
  let globalMint: PublicKey;
  let globalMintAuthority: anchor.web3.Keypair;
  let globalPlayers: Array<{
    player: anchor.web3.Keypair;
    playerTokenAccount: any;
    playerBalancePDA: PublicKey;
  }> = [];

  async function getGamePDA() {
    const secretKeyBuffer = anchor.web3.Keypair.generate().secretKey.slice(0, 32);
    const secretKey = Array.from(secretKeyBuffer);
    const randomHashBuffer = createHash("sha256").update(secretKeyBuffer).digest();
    const randomHash = Array.from(randomHashBuffer);

    const [gamePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), randomHashBuffer],
      program.programId
    );

    return { gamePDA, randomHash, secretKey };
  }

  // Setup function
  before(async () => {
    console.log("🚀 Setting up merkle tree test environment...");

    // Initialize oracle
    const config = {
      feePercentage: 1,
      oracleBufferTime: 2,
      maxPlayers: 100,
      maxTimeout: 86400,
      minTimeout: 1,
    };

    try {
      const signature = await program.provider.connection.requestAirdrop(
        program.provider.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      await program.provider.connection.confirmTransaction(signature);

      await program.methods
        .initializeOracle(config)
        .accounts({
          authority: program.provider.publicKey,
        })
        .rpc();

      console.log("✅ Oracle initialized");
    } catch (e) {
      console.log("Oracle already exists, continuing...");
    }

    // Create global token mint
    const { mint, mintAuthority } = await createGlobalTokenMint();
    globalMint = mint;
    globalMintAuthority = mintAuthority;

    // Pre-create players
    await createPlayerPool(5);
    console.log("✅ Merkle tree test setup complete");
  });

  async function createGlobalTokenMint() {
    const mintAuthority = anchor.web3.Keypair.generate();

    const signature = await program.provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(signature);

    const mint = await createMint(
      program.provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("game_vault"), mint.toBuffer()],
      program.programId
    );

    await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      gameVaultPDA,
      true
    );

    await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      mintAuthority,
      mint,
      program.provider.publicKey
    );

    const tokenConfig = { minAmount: new anchor.BN(1000), enabled: true };
    await program.methods
      .initializeToken(tokenConfig)
      .accounts({
        authority: program.provider.publicKey,
        tokenMint: mint,
      })
      .rpc();

    return { mint, mintAuthority };
  }

  async function createPlayerPool(count: number) {
    const players = Array.from({ length: count }, () =>
      anchor.web3.Keypair.generate()
    );

    // Batch airdrop
    const airdropPromises = players.map((player) =>
      program.provider.connection.requestAirdrop(
        player.publicKey,
        3 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    const signatures = await Promise.all(airdropPromises);
    await Promise.all(
      signatures.map((sig) =>
        program.provider.connection.confirmTransaction(sig)
      )
    );

    // Create player data
    const playerPromises = players.map(async (player) => {
      const playerTokenAccount = await getOrCreateAssociatedTokenAccount(
        program.provider.connection,
        player,
        globalMint,
        player.publicKey
      );

      await program.methods
        .initializePlayerBalance()
        .accounts({
          player: player.publicKey,
          tokenMint: globalMint,
        })
        .signers([player])
        .rpc();

      const [playerBalancePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_balance"),
          player.publicKey.toBuffer(),
          globalMint.toBuffer(),
        ],
        program.programId
      );

      // Mint tokens
      await mintTo(
        program.provider.connection,
        globalMintAuthority,
        globalMint,
        playerTokenAccount.address,
        globalMintAuthority,
        10_000_000
      );

      return { player, playerTokenAccount, playerBalancePDA };
    });

    globalPlayers = await Promise.all(playerPromises);
  }

  describe("Merkle Tree Helper Functions", () => {
    it("should hash participation entries correctly", async () => {
      const entry = createParticipationEntry(
        globalPlayers[0].player.publicKey,
        0,
        1640995200 // Fixed timestamp for reproducible tests
      );

      const hash = hashParticipationEntry(entry);
      expect(hash).to.have.length(32);
      expect(hash.every(byte => byte >= 0 && byte <= 255)).to.be.true;
    });

    it("should build merkle tree for single player", async () => {
      const entry = createParticipationEntry(
        globalPlayers[0].player.publicKey,
        0
      );

      const { root, tree, proofs } = buildMerkleTree([entry]);

      expect(root).to.have.length(32);
      expect(tree).to.have.length(1); // Only leaves level
      expect(proofs.has(0)).to.be.true;

      const proof = proofs.get(0)!;
      // For single entry, root should equal the leaf
      expect(root).to.deep.equal(proof.leaf);
      expect(proof.proof).to.have.length(0); // No proof needed for single entry
    });

    it("should build merkle tree for multiple players", async () => {
      const entries = [
        createParticipationEntry(globalPlayers[0].player.publicKey, 0),
        createParticipationEntry(globalPlayers[1].player.publicKey, 1),
        createParticipationEntry(globalPlayers[2].player.publicKey, 2),
      ];

      const { root, tree, proofs } = buildMerkleTree(entries);

      expect(root).to.have.length(32);
      expect(tree.length).to.be.greaterThan(1); // Multiple levels

      // Verify all proofs
      for (let i = 0; i < entries.length; i++) {
        const proof = proofs.get(i)!;
        expect(verifyMerkleProof(proof.leaf, proof.proof, root, i)).to.be.true;
      }
    });

    it("should handle adding new entry to existing tree", async () => {
      const existingEntries = [
        createParticipationEntry(globalPlayers[0].player.publicKey, 0),
        createParticipationEntry(globalPlayers[1].player.publicKey, 1),
      ];

      const newEntry = createParticipationEntry(
        globalPlayers[2].player.publicKey,
        2
      );

      const { newRoot, unchangedSubtrees } = addEntryToTree(existingEntries, newEntry);

      expect(newRoot).to.have.length(32);
      expect(unchangedSubtrees).to.be.an('array');

      // Verify the new tree includes all entries
      const allEntries = [...existingEntries, newEntry];
      const { root: expectedRoot } = buildMerkleTree(allEntries);
      expect(newRoot).to.deep.equal(expectedRoot);
    });
  });

  describe("Game Lifecycle with Merkle Trees", () => {
    it("should initialize game successfully", async () => {
      const { gamePDA, randomHash } = await getGamePDA();
      const creator = globalPlayers[0];

      const gameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1000),
        maxPlayers: 4,
        minPlayers: 2,
        timeout: 60,
        isPrivate: false,
      };

      await program.methods
        .initializeGame(gameConfig, randomHash)
        .accounts({
          creator: creator.player.publicKey,
          tokenMint: globalMint,
        })
        .signers([creator.player])
        .rpc();

      const gameAccount = await program.account.game.fetch(gamePDA);
      expect(gameAccount.playersCount).to.equal(0);
      expect(gameAccount.merkleRoot.every(byte => byte === 0)).to.be.true; // Empty root
    });

    it("should allow first player to join with merkle tree", async () => {
      const { gamePDA, randomHash } = await getGamePDA();
      const creator = globalPlayers[0];
      const player = globalPlayers[1];

      // Initialize game
      const gameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1000),
        maxPlayers: 4,
        minPlayers: 2,
        timeout: 60,
        isPrivate: false,
      };

      await program.methods
        .initializeGame(gameConfig, randomHash)
        .accounts({
          creator: creator.player.publicKey,
          tokenMint: globalMint,
        })
        .signers([creator.player])
        .rpc();

      // For the first player, the contract expects:
      // - old_root == [0; 32]
      // - new_root == new_leaf (hash of participation entry)

      // We need to calculate what the contract will create as the participation entry
      // The contract creates: player, ticket_amount, player_index=0, current_time, entry_count=1
      // For first player, merkle tree is managed automatically

      // Join game - merkle tree is now managed automatically
      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player.player.publicKey,
        })
        .signers([player.player])
        .rpc();

      const gameAccount = await program.account.game.fetch(gamePDA);
      expect(gameAccount.playersCount).to.equal(1);
      expect(gameAccount.totalAmount.toNumber()).to.equal(1000);
    });

    it("should allow multiple players to join with merkle tree updates", async () => {
      const { gamePDA, randomHash } = await getGamePDA();
      const creator = globalPlayers[0];
      const player1 = globalPlayers[1];
      const player2 = globalPlayers[2];

      // Initialize game
      const gameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1000),
        maxPlayers: 4,
        minPlayers: 2,
        timeout: 60,
        isPrivate: false,
      };

      await program.methods
        .initializeGame(gameConfig, randomHash)
        .accounts({
          creator: creator.player.publicKey,
          tokenMint: globalMint,
        })
        .signers([creator.player])
        .rpc();

      // First player joins

      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player1.player.publicKey,
        })
        .signers([player1.player])
        .rpc();

      // Second player joins

      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player2.player.publicKey,
        })
        .signers([player2.player])
        .rpc();

      const gameAccount = await program.account.game.fetch(gamePDA);
      expect(gameAccount.playersCount).to.equal(2);
      expect(gameAccount.totalAmount.toNumber()).to.equal(2000);
    });

    it("should complete game with merkle proof winner verification", async () => {
      const { gamePDA, randomHash, secretKey } = await getGamePDA();
      const creator = globalPlayers[0];
      const player1 = globalPlayers[1];
      const player2 = globalPlayers[2];
      const player3 = globalPlayers[3];

      // Initialize and populate game with 3 players
      const gameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1000),
        maxPlayers: 3,
        minPlayers: 3,
        timeout: 60,
        isPrivate: false,
      };

      await program.methods
        .initializeGame(gameConfig, randomHash)
        .accounts({
          creator: creator.player.publicKey,
          tokenMint: globalMint,
        })
        .signers([creator.player])
        .rpc();

      // Add both players and capture exact timestamps
      const tx1 = await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player1.player.publicKey,
        })
        .signers([player1.player])
        .rpc();

      const tx2 = await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player2.player.publicKey,
        })
        .signers([player2.player])
        .rpc();

      const tx3 = await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player3.player.publicKey,
        })
        .signers([player3.player])
        .rpc();

      // Get the exact timestamps from the blockchain transactions
      const tx1Info = await program.provider.connection.getParsedTransaction(tx1, { commitment: "confirmed" });
      const tx2Info = await program.provider.connection.getParsedTransaction(tx2, { commitment: "confirmed" });
      const tx3Info = await program.provider.connection.getParsedTransaction(tx3, { commitment: "confirmed" });

      const player1JoinTime = tx1Info?.blockTime || 0;
      const player2JoinTime = tx2Info?.blockTime || 0;
      const player3JoinTime = tx3Info?.blockTime || 0;

      // Calculate winner
      const gameAccount = await program.account.game.fetch(gamePDA);
      const winnerIndex = calculateWinnerIndex(3, secretKey, gameAccount.lastSlot.toNumber());

      // Create exact participation entries that match what the contract created
      const participation1 = createParticipationEntry(
        player1.player.publicKey,
        0,
        player1JoinTime
      );
      const participation2 = createParticipationEntry(
        player2.player.publicKey,
        1,
        player2JoinTime
      );
      const participation3 = createParticipationEntry(
        player3.player.publicKey,
        2,
        player3JoinTime
      );

      // For 3 players: recreate contract's exact merkle structure
      // 1. First 2 players create a subtree
      const leaf1 = hashParticipationEntry(participation1);
      const leaf2 = hashParticipationEntry(participation2);
      const subtreeRoot = hashNodes(leaf1, leaf2); // 2-player subtree

      // 2. Third player goes in recent buffer
      const leaf3 = hashParticipationEntry(participation3);

      // 3. Contract computes root from [subtreeRoot, leaf3]
      const expectedContractRoot = hashNodes(subtreeRoot, leaf3);

      // Build correct proof based on winner index
      const allParticipations = [participation1, participation2, participation3];
      const winnerParticipation = allParticipations[winnerIndex];

      let winnerProof: number[][];
      if (winnerIndex === 0) {
        // Winner is player 1: proof is [leaf2, leaf3] to get to root
        winnerProof = [leaf2, leaf3];
      } else if (winnerIndex === 1) {
        // Winner is player 2: proof is [leaf1, leaf3] to get to root
        winnerProof = [leaf1, leaf3];
      } else {
        // Winner is player 3: proof is [subtreeRoot] to get to root
        winnerProof = [subtreeRoot];
      }

      // Debug: Check merkle root
      const contractRoot = Array.from(gameAccount.merkleRoot);
      console.log("Contract merkle root:", contractRoot);
      console.log("Expected root:", expectedContractRoot);
      console.log("Winner index:", winnerIndex);
      console.log("Roots match:", contractRoot.every((byte, i) => byte === expectedContractRoot[i]));

      // Complete game with merkle proof (interface remains the same)
      await program.methods
        .completeGame(
          randomHash,
          secretKey,
          winnerParticipation,
          winnerProof
        )
        .accounts({
          authority: program.provider.publicKey,
          winner: winnerParticipation.player,
          creator: creator.player.publicKey,
        })
        .rpc();

      const completedGame = await program.account.game.fetch(gamePDA);
      expect(completedGame.totalAmount.toNumber()).to.equal(0); // Game completed
    });
  });

  describe("Error Handling", () => {
    it("should fail when merkle proof verification fails", async () => {
      const { gamePDA, randomHash, secretKey } = await getGamePDA();
      const creator = globalPlayers[0];
      const player1 = globalPlayers[1];

      // Initialize game with minimum valid players
      const gameConfig = {
        gameType: { coinflip: {} },
        amount: new anchor.BN(1000),
        maxPlayers: 2,
        minPlayers: 2,
        timeout: 60,
        isPrivate: false,
      };

      await program.methods
        .initializeGame(gameConfig, randomHash)
        .accounts({
          creator: creator.player.publicKey,
          tokenMint: globalMint,
        })
        .signers([creator.player])
        .rpc();

      // Add first player

      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player1.player.publicKey,
        })
        .signers([player1.player])
        .rpc();

      // Add second player to make game completable
      const player2 = globalPlayers[2];

      await program.methods
        .joinGame()
        .accounts({
          game: gamePDA,
          player: player2.player.publicKey,
        })
        .signers([player2.player])
        .rpc();

      // Try to complete with wrong proof (fake player that's not in the game)
      const fakeParticipation = createParticipationEntry(
        globalPlayers[3].player.publicKey, // Wrong player (not in game)
        0 // Wrong index too
      );
      const wrongProof = [[...new Array(32).fill(0)]]; // Invalid proof

      try {
        await program.methods
          .completeGame(
            randomHash,
            secretKey,
            fakeParticipation,
            wrongProof
          )
          .accounts({
            authority: program.provider.publicKey,
            winner: fakeParticipation.player,
            creator: creator.player.publicKey,
          })
          .rpc();

        expect.fail("Should have failed with invalid proof");
      } catch (error) {
        expect(error.toString()).to.include("UnauthorizedPlayer");
      }
    });
  });
});

// Helper function to calculate winner (matches contract logic)
function calculateWinnerIndex(
  playersCount: number,
  secretKey: number[],
  lastSlot: number
): number {
  if (playersCount === 1) return 0;

  const nPlayers = BigInt(playersCount);
  const combinedData = new Uint8Array(40);
  combinedData.set(secretKey, 0);

  const lastSlotBytes = new Uint8Array(8);
  const lastSlotView = new DataView(lastSlotBytes.buffer);
  lastSlotView.setBigUint64(0, BigInt(lastSlot), true);
  combinedData.set(lastSlotBytes, 32);

  const entropyHash = createHash("sha256").update(combinedData).digest();
  const maxValid = BigInt("0xFFFFFFFFFFFFFFFF") - (BigInt("0xFFFFFFFFFFFFFFFF") % nPlayers);

  for (let startPos = 0; startPos <= 32 - 8; startPos++) {
    const randomBytes = entropyHash.slice(startPos, startPos + 8);
    const randomU64 = new DataView(randomBytes.buffer).getBigUint64(0, true);

    if (randomU64 < maxValid) {
      return Number(randomU64 % nPlayers);
    }
  }

  throw new Error("Unable to generate unbiased random number");
}
