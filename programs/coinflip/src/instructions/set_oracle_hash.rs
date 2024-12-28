use crate::state::GameStatus;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::sysvar::slot_hashes;
use anchor_spl::token;

pub fn handler(ctx: Context<super::SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game;

    let fee_amount = game.amount * (ctx.accounts.oracle.fee_percentage as u64) / 100;
    game.fee_amount = fee_amount;

    // Get slot hash for on-chain randomness
    let slot_hash = slot_hashes::id().to_bytes();

    // Combine oracle hash with slot hash
    let mut combined = Vec::with_capacity(64); // 32 + 32
    combined.extend_from_slice(&hash_value);
    combined.extend_from_slice(&slot_hash);
    let final_hash = hash(&combined).to_bytes();

    let random_index = (final_hash[0] as usize) % game.players.len();
    game.winner = game.players[random_index];
    game.status = GameStatus::ReadyForClaim;

    // Transfer fees to oracle
    if game.fee_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.game_token_account.to_account_info(),
                    to: ctx.accounts.oracle_token_account.to_account_info(),
                    authority: ctx.accounts.game_vault.to_account_info(),
                },
            ),
            game.fee_amount,
        )?;
    }

    Ok(())
}
