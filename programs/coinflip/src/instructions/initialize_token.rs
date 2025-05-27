use crate::TokenConfig;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeToken>, config: TokenConfig) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.initialize(
        ctx.accounts.token_mint.key(),
        config.min_amount,
        config.enabled,
    );

    Ok(())
}
