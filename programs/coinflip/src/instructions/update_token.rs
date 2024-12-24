use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateToken>, ticker: String, enabled: bool) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.ticker = ticker;
    game_token.enabled = enabled;
    Ok(())
} 