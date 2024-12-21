use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::sysvar::slot_hashes;

use crate::state::GameStatus;

pub fn handler(ctx: Context<super::SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game;

    game.oracle_hash = hash_value;

    // Get slot hash for on-chain randomness
    let slot_hash = slot_hashes::id().to_bytes();

    // Combine oracle hash with slot hash
    let mut combined = Vec::with_capacity(64); // 32 + 32
    combined.extend_from_slice(&hash_value);
    combined.extend_from_slice(&slot_hash);
    let final_hash = hash(&combined).to_bytes();

    let random_index = (final_hash[0] as usize) % game.participants.len();
    game.winner = Some(game.participants[random_index]);
    game.status = GameStatus::ReadyForClaim;

    Ok(())
}
