use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

use crate::error::ErrorCode;
use crate::state::GameStatus;

pub fn handler(ctx: Context<super::SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.oracle.key() == ctx.accounts.config.operator,
        ErrorCode::InvalidOperator
    );

    let game = &mut ctx.accounts.game;
    require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);
    require!(game.ready_for_oracle, ErrorCode::GameNotFull);
    require!(game.oracle_hash.is_none(), ErrorCode::OracleHashAlreadySet);

    game.oracle_hash = Some(hash_value);

    // Combine oracle hash with blockhash for randomness
    let blockhash = ctx.accounts.recent_blockhash.key().to_bytes();
    let mut combined = Vec::with_capacity(64);
    combined.extend_from_slice(&hash_value);
    combined.extend_from_slice(&blockhash);
    let final_hash = hash(&combined).to_bytes();

    let random_index = (final_hash[0] as usize) % game.participants.len();
    game.winner = Some(game.participants[random_index]);
    game.status = GameStatus::ReadyForClaim;

    Ok(())
}
