use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::sysvar::slot_hashes;

use crate::state::GameStatus;

pub fn handler(ctx: Context<super::SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game;

    game.oracle_hash = hash_value;

    // Get current timestamp and slot hash for additional randomness
    let timestamp = Clock::get()?.unix_timestamp.to_le_bytes();
    let slot_hash = slot_hashes::id().to_bytes();

    // Combine all sources of randomness
    let mut combined = Vec::with_capacity(72); // 32 + 8 + 32
    combined.extend_from_slice(&hash_value);
    combined.extend_from_slice(&timestamp);
    combined.extend_from_slice(&slot_hash);
    let final_hash = hash(&combined).to_bytes();

    let random_index = (final_hash[0] as usize) % game.participants.len();
    game.winner = Some(game.participants[random_index]);
    game.status = GameStatus::ReadyForClaim;

    Ok(())
}
