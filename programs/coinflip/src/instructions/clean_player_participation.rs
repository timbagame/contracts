use anchor_lang::prelude::*;

// NOTE: This instruction is deprecated with the merkle tree approach
// Player participation is no longer stored in separate accounts
// Emergency recovery would be handled differently with merkle proofs

pub fn handler(_ctx: Context<super::CleanPlayerParticipation>) -> Result<()> {
    // This instruction is no longer needed with merkle trees
    // All participation data is now in the game's merkle root + events
    // Emergency recovery would use merkle proofs instead
    
    Err(crate::error::ErrorCode::InvalidGameType.into()) // Deprecated
}
