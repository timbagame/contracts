use crate::{events::TokenUpdated, TokenConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateToken>, config: TokenConfig) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let token_mint_key = ctx.accounts.token_mint.key();

    game_token.update_config(config.min_amount, config.enabled);

    emit!(TokenUpdated::from_config(token_mint_key, &config));

    Ok(())
}
