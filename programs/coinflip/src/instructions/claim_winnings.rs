use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::GameStatus;

pub fn handler(ctx: Context<super::ClaimWinnings>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let config = &ctx.accounts.config;

    require!(
        game.status == GameStatus::ReadyForClaim,
        ErrorCode::GameNotReadyForClaim
    );
    require!(
        game.winner.unwrap() == ctx.accounts.winner.key(),
        ErrorCode::NotWinner
    );

    let total_pot = game.amount * (game.max_participants as u64);
    let fee_amount = (total_pot * config.fee_percentage) / 100;
    let winner_amount = total_pot - fee_amount;

    // Transfer winnings to winner (fees stay in vault)
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
        ),
        winner_amount,
    )?;

    game.status = GameStatus::Completed;
    Ok(())
}
