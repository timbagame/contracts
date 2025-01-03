use crate::events::PlayerTransfer;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::DepositPlayer>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.depositor_token_account.to_account_info(),
                to: ctx.accounts.player_token_account.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(PlayerTransfer {
        source: ctx.accounts.depositor.key(),
        destination: ctx.accounts.player.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
