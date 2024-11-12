use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::CollectFees>, amount: u64) -> Result<()> {
    // Transfer fees to treasury
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
        ),
        amount,
    )?;

    Ok(())
}
