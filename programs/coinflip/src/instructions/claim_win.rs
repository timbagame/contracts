use crate::state::GameStatus;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::ClaimWin>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.status = GameStatus::Completed;

    // Transfer funds to winner
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.game_token_account.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.game_vault.to_account_info(),
            },
        ),
        game.winner_amount,
    )?;

    Ok(())
}
