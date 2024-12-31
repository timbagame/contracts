use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::events::PlayerJoined;
use crate::state::GameType;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Only transfer tokens if it's a coinflip game
    if game.game_type == GameType::Coinflip {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.player_token_account.to_account_info(),
                    to: ctx.accounts.game_token_account.to_account_info(),
                    authority: ctx.accounts.player_vault.to_account_info(),
                },
                &[&[
                    b"player_vault",
                    ctx.accounts.player.key().as_ref(),
                    game.token_mint.as_ref(),
                    &[ctx.bumps.player_vault],
                ]],
            ),
            game.amount,
        )?;
    }

    game.players.push(ctx.accounts.player.key());

    emit!(PlayerJoined {
        game_id: game.id,
        player: ctx.accounts.player.key(),
    });

    Ok(())
}
