use crate::events::PlayerTransfer;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::WithdrawPlayer>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.destination_token_account.to_account_info(),
                authority: ctx.accounts.player_vault.to_account_info(),
            },
            &[&[
                b"player_vault",
                ctx.accounts.player.key().as_ref(),
                &[ctx.bumps.player_vault],
            ]],
        ),
        amount,
    )?;

    emit!(PlayerTransfer {
        source: ctx.accounts.player.key(),
        destination: ctx.accounts.destination.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
