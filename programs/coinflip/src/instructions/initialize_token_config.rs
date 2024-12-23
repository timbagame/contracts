use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeTokenConfig>, ticker: String, allowed: bool) -> Result<()> {
    let token_config = &mut ctx.accounts.token_config;
    token_config.ticker = ticker;
    token_config.token_mint = ctx.accounts.token_mint.key();
    token_config.allowed = allowed;
    Ok(())
}
