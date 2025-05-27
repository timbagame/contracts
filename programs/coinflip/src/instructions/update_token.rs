use crate::TokenConfig;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateToken>, config: TokenConfig) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.update_config(config.min_amount, config.enabled);

    Ok(())
}
