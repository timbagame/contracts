use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::events::GameCancelled;
use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    if game.status == GameStatus::Active {
        game.status = GameStatus::Cancelled;
    }

    // Only return funds for giveaway games
    if game.game_type == GameType::Giveaway {
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
                    game.token_mint.as_ref(),
                    &[ctx.bumps.game_vault],
                ]],
            ),
            game.amount,
        )?;
    }

    emit!(GameCancelled { game_id: game.id });

    Ok(())
}
