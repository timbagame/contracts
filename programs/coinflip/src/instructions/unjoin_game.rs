use anchor_lang::prelude::*;

pub fn handler(
    _ctx: Context<super::UnjoinGame>,
    _player_merkle_proof: Vec<[u8; 32]>,
    _updated_merkle_root: [u8; 32],
) -> Result<()> {
    // TODO: Implement merkle tree unjoin verification
    // This is complex and requires:
    // 1. Verify player is in the merkle tree with merkle proof
    // 2. Calculate new merkle root after removing player (tree restructuring)
    // 3. Handle index reordering in the merkle tree
    // 4. Update game state
    
    // For now, return error - unjoin with merkle trees needs full implementation
    Err(crate::error::ErrorCode::InvalidGameType.into()) // TODO: Implement merkle unjoin
}
