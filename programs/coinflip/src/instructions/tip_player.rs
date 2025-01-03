use crate::events::PlayerTransfer;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::TipPlayer>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.tipper_token_account.to_account_info(),
                to: ctx.accounts.destination_token_account.to_account_info(),
                authority: ctx.accounts.tipper_vault.to_account_info(),
            },
            &[&[
                b"player_vault",
                ctx.accounts.tipper.key().as_ref(),
                ctx.accounts.game_token.token_mint.as_ref(),
                &[ctx.bumps.tipper_vault],
            ]],
        ),
        amount,
    )?;

    emit!(PlayerTransfer {
        source: ctx.accounts.tipper.key(),
        destination: ctx.accounts.destination.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
