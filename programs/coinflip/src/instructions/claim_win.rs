use crate::events::WinClaimed;
use crate::state::GameStatus;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::ClaimWin>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.status = GameStatus::Completed;

    let winner = &mut ctx.accounts.winner;
    winner.games_won += 1;

    // Transfer funds to winner
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.game_token_account.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.game_vault.to_account_info(),
            },
            &[&[
                b"game_vault",
                game.token_mint.as_ref(),
                &[ctx.bumps.game_vault],
            ]],
        ),
        game.winner_amount,
    )?;

    emit!(WinClaimed {
        game_id: game.id,
        winner: winner.key(),
        amount: game.winner_amount,
    });

    Ok(())
}
