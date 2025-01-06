use crate::events::OracleHashSet;
use crate::state::GameStatus;
use crate::state::GameType;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token;

pub fn handler(ctx: Context<super::SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Calculate winner amount and fee amount checking game type
    let total_amount = if game.game_type == GameType::Coinflip {
        game.amount * game.players.len() as u64
    } else {
        game.amount
    };
    game.fee_amount = total_amount * (ctx.accounts.oracle.fee_percentage as u64) / 100;
    game.winner_amount = total_amount - game.fee_amount;

    // Get current time for randomness
    let current_time = Clock::get()?.unix_timestamp.to_le_bytes();

    // Combine oracle hash with current time
    let mut combined = [0u8; 40];
    combined[..32].copy_from_slice(&hash_value);
    combined[32..].copy_from_slice(&current_time);
    let final_hash = hash(&combined).to_bytes();
    let random_number = usize::from_le_bytes(final_hash[0..8].try_into().unwrap());
    let random_index = random_number % game.players.len();
    game.winner = game.players[random_index];
    game.status = GameStatus::ReadyForClaim;

    // Transfer fees to oracle
    if game.fee_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.game_token_account.to_account_info(),
                    to: ctx.accounts.oracle_token_account.to_account_info(),
                    authority: ctx.accounts.game_vault.to_account_info(),
                },
                &[&[
                    b"game_vault",
                    game.token_mint.as_ref(),
                    &[ctx.bumps.game_vault],
                ]],
            ),
            game.fee_amount,
        )?;
    }

    emit!(OracleHashSet { game_id: game.id });

    Ok(())
}
