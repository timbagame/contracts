use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateTokenConfig>, ticker: String, allowed: bool) -> Result<()> {
    let token_config = &mut ctx.accounts.token_config;
    token_config.ticker = ticker;
    token_config.allowed = allowed;
    Ok(())
} 