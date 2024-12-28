use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    if game.status == GameStatus::Active {
        game.status = GameStatus::Cancelled;
    }

    // Only return funds for giveaway games
    if game.game_type == GameType::Giveaway {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.game_token_account.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.game_vault.to_account_info(),
                },
            ),
            game.amount,
        )?;
    }

    Ok(())
}
