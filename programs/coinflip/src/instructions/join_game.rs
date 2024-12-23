use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::GameType;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Only transfer tokens if it's a coinflip game
    if game.game_type == GameType::Coinflip {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.player_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            game.amount,
        )?;
    }

    game.add_participant(ctx.accounts.player.key());
    Ok(())
}
