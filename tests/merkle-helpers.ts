import { createHash } from "crypto";
import * as anchor from "@coral-xyz/anchor";

/**
 * Merkle tree helper functions for testing the new merkle tree-based game system
 */

export interface ParticipationEntry {
  player: anchor.web3.PublicKey;
  playerIndex: number;
}

export interface SubtreeProof {
  subtreeRoot: number[];
  subtreePosition: number;
  treeLevel: number;
}

export interface MerkleProof {
  leaf: number[];
  proof: number[][];
  leafIndex: number;
}

/**
 * Hash a participation entry to create a merkle tree leaf
 * Uses Borsh serialization to match the contract's try_to_vec() output
 */
export function hashParticipationEntry(entry: ParticipationEntry): number[] {
  // Borsh serialization for ParticipationEntry struct:
  // player: Pubkey (32 bytes)
  // player_index: u32 (4 bytes, little-endian)
  const buffer = Buffer.alloc(32 + 4);
  
  let offset = 0;
  
  // player: Pubkey (32 bytes)
  entry.player.toBuffer().copy(buffer, offset);
  offset += 32;
  
  // player_index: u32 (4 bytes, little-endian)
  buffer.writeUInt32LE(entry.playerIndex, offset);
  
  const hash = createHash("sha256").update(buffer).digest();
  return Array.from(hash);
}

/**
 * Hash two child nodes to create parent node
 */
export function hashNodes(left: number[], right: number[]): number[] {
  const combined = Buffer.concat([Buffer.from(left), Buffer.from(right)]);
  const hash = createHash("sha256").update(combined).digest();
  return Array.from(hash);
}

/**
 * Build a complete binary merkle tree from participation entries
 */
export function buildMerkleTree(entries: ParticipationEntry[]): {
  root: number[];
  tree: number[][][]; // [level][position] = hash
  proofs: Map<number, MerkleProof>; // playerIndex -> proof
} {
  if (entries.length === 0) {
    return {
      root: new Array(32).fill(0),
      tree: [],
      proofs: new Map(),
    };
  }

  // Hash all entries to create leaves
  const leaves = entries.map(hashParticipationEntry);
  
  // For single entry, root is the leaf itself (to match contract logic)
  if (entries.length === 1) {
    const tree: number[][][] = [leaves];
    const proofs = new Map<number, MerkleProof>();
    proofs.set(0, {
      leaf: leaves[0],
      proof: [], // No proof needed for single entry
      leafIndex: 0,
    });
    
    return {
      root: leaves[0],
      tree,
      proofs,
    };
  }
  
  // Build tree level by level for multiple entries
  const tree: number[][][] = [leaves];
  let currentLevel = leaves;
  
  while (currentLevel.length > 1) {
    const nextLevel: number[][] = [];
    
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : new Array(32).fill(0);
      nextLevel.push(hashNodes(left, right));
    }
    
    tree.push(nextLevel);
    currentLevel = nextLevel;
  }
  
  const root = currentLevel.length > 0 ? currentLevel[0] : new Array(32).fill(0);
  
  // Generate proofs for each leaf
  const proofs = new Map<number, MerkleProof>();
  
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    const proof: number[][] = [];
    let currentIndex = leafIndex;
    
    for (let level = 0; level < tree.length - 1; level++) {
      const isRightChild = currentIndex % 2 === 1;
      const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;
      
      if (siblingIndex < tree[level].length) {
        proof.push(tree[level][siblingIndex]);
      } else {
        proof.push(new Array(32).fill(0));
      }
      
      currentIndex = Math.floor(currentIndex / 2);
    }
    
    proofs.set(leafIndex, {
      leaf: leaves[leafIndex],
      proof,
      leafIndex,
    });
  }
  
  return { root, tree, proofs };
}

/**
 * Add a new entry to an existing merkle tree and return the new root
 */
export function addEntryToTree(
  existingEntries: ParticipationEntry[],
  newEntry: ParticipationEntry
): {
  newRoot: number[];
  unchangedSubtrees: SubtreeProof[];
} {
  const allEntries = [...existingEntries, newEntry];
  const { root: newRoot } = buildMerkleTree(allEntries);
  
  // For simplicity in tests, we'll mark all existing subtrees as unchanged
  // In practice, the client would calculate which subtrees are actually unchanged
  const unchangedSubtrees: SubtreeProof[] = [];
  
  if (existingEntries.length > 0) {
    // Add some subtree proofs (simplified for testing)
    const oldTree = buildMerkleTree(existingEntries);
    
    // Mark lower levels as unchanged where possible
    for (let level = 0; level < Math.min(oldTree.tree.length, 3); level++) {
      for (let pos = 0; pos < oldTree.tree[level].length; pos++) {
        // Only include positions that won't be affected by the new insertion
        const affectedPositions = getAffectedPositions(existingEntries.length, level);
        if (!affectedPositions.includes(pos)) {
          unchangedSubtrees.push({
            subtreeRoot: oldTree.tree[level][pos],
            subtreePosition: pos,
            treeLevel: level,
          });
        }
      }
    }
  }
  
  return { newRoot, unchangedSubtrees };
}

/**
 * Get positions in the tree that would be affected by adding a new entry
 */
function getAffectedPositions(existingCount: number, level: number): number[] {
  const affected: number[] = [];
  let index = existingCount;
  
  for (let i = 0; i <= level; i++) {
    affected.push(index);
    index = Math.floor(index / 2);
  }
  
  return affected;
}

/**
 * Create a participation entry for testing
 */
export function createParticipationEntry(
  player: anchor.web3.PublicKey,
  playerIndex: number
): ParticipationEntry {
  return {
    player,
    playerIndex,
  };
}

/**
 * Verify a merkle proof matches the root
 */
export function verifyMerkleProof(
  leaf: number[],
  proof: number[][],
  root: number[],
  leafIndex: number
): boolean {
  // For single entry tree (no proof), leaf should equal root
  if (proof.length === 0) {
    return leaf.every((byte, i) => byte === root[i]);
  }
  
  let currentHash = leaf;
  let currentIndex = leafIndex;
  
  for (const proofElement of proof) {
    if (currentIndex % 2 === 0) {
      // Current node is left child
      currentHash = hashNodes(currentHash, proofElement);
    } else {
      // Current node is right child
      currentHash = hashNodes(proofElement, currentHash);
    }
    currentIndex = Math.floor(currentIndex / 2);
  }
  
  return currentHash.every((byte, i) => byte === root[i]);
}