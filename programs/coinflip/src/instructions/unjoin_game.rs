use crate::state::GameType;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

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
