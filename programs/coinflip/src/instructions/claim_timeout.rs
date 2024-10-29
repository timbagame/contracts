use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::GameStatus;

pub fn handler(ctx: Context<super::ClaimTimeout>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let current_time = Clock::get()?.unix_timestamp;

    require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);
    require!(
        current_time >= game.created_at + game.timeout_duration,
        ErrorCode::TimeoutNotReached
    );

    // Return tokens to participants
    for _participant in &game.participants {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.participant_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
            ),
            game.amount,
        )?;
    }

    game.status = GameStatus::Cancelled;
    Ok(())
}
