use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::GameType;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Check player token amount
    if game.game_type == GameType::Coinflip {
        let player_token = &mut ctx.accounts.player_token;
        let needed_amount = if player_token.amount >= game.amount {
            player_token.amount -= game.amount;
            0
        } else {
            let needed = game.amount - player_token.amount;
            player_token.amount = 0;
            needed
        };

        // Only transfer if additional tokens are needed
        if needed_amount > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.player_token_account.to_account_info(),
                        to: ctx.accounts.game_token_account.to_account_info(),
                        authority: ctx.accounts.player.to_account_info(),
                    },
                ),
                needed_amount,
            )?;
        }
    }

    game.players.push(ctx.accounts.player.key());

    Ok(())
}
