use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::WithdrawPlayer>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.receiver_token_account.to_account_info(),
                authority: ctx.accounts.player_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    Ok(())
}
