use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Return tokens if it's a giveaway game
    if game.game_type == GameType::Giveaway {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[&[b"vault", game.token_mint.as_ref(), &[ctx.bumps.vault]]],
            ),
            game.amount,
        )?;
    }

    game.status = GameStatus::Cancelled;
    Ok(())
} 