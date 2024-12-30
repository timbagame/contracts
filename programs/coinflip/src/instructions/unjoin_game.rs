use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // If game is active and buffer time has passed, cancel it
    if game.status == GameStatus::Active
        && game.buffer_passed(ctx.accounts.oracle.oracle_buffer_time)
    {
        game.status = GameStatus::Cancelled;
    }

    // Remove player
    if let Some(pos) = game
        .players
        .iter()
        .position(|x| *x == ctx.accounts.player.key())
    {
        game.players.remove(pos);

        // Return funds if it's a coinflip game
        if game.game_type == GameType::Coinflip {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.game_token_account.to_account_info(),
                        to: ctx.accounts.player_token_account.to_account_info(),
                        authority: ctx.accounts.game_vault.to_account_info(),
                    },
                    &[&[
                        b"game_vault",
                        ctx.accounts.player.key().as_ref(),
                        game.token_mint.as_ref(),
                        &[ctx.bumps.game_vault],
                    ]],
                ),
                game.amount,
            )?;
        }
    }

    Ok(())
}
