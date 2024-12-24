use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeToken>, ticker: String, enabled: bool) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.ticker = ticker;
    game_token.token_mint = ctx.accounts.token_mint.key();
    game_token.token_account = ctx.accounts.token_account.key();
    game_token.enabled = enabled;
    Ok(())
}
