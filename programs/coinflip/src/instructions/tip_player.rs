use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::TipPlayer>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.tipper_token_account.to_account_info(),
                to: ctx.accounts.receiver_token_account.to_account_info(),
                authority: ctx.accounts.tipper_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    Ok(())
}
