use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::GameType;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Remove participant
    if let Some(pos) = game
        .participants
        .iter()
        .position(|x| x == &ctx.accounts.player.key())
    {
        game.participants.remove(pos);
    }

    // Only return tokens if it's a coinflip game
    if game.game_type == GameType::Coinflip {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.participant_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[&[b"vault", game.token_mint.as_ref(), &[ctx.bumps.vault]]],
            ),
            game.amount,
        )?;
    }

    Ok(())
}
