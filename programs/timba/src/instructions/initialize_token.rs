use crate::{events::TokenInitialized, TokenConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeToken>, config: TokenConfig) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let token_mint_key = ctx.accounts.token_mint.key();

    game_token.initialize(
        token_mint_key,
        ctx.bumps.game_vault,
        config.min_amount,
        config.enabled,
    );

    emit!(TokenInitialized::from_config(token_mint_key, &config));

    Ok(())
}
