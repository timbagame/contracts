use crate::events::TokenClosed;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CloseToken>) -> Result<()> {
    let operator_key = ctx.accounts.oracle_operator.key();
    let token_mint_key = ctx.accounts.token_mint.key();

    ctx.accounts.game_token.close_vault_account(
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.oracle_operator.to_account_info(),
        ctx.accounts.game_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    )?;

    emit!(TokenClosed::new(operator_key, token_mint_key));

    Ok(())
}
