use crate::{events::TokenUpdated, TokenConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateToken>, config: TokenConfig) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let token_mint_key = ctx.accounts.token_mint.key();

    // ===============================
    // STATE UPDATES
    // ===============================

    game_token.update_config(config.min_amount, config.enabled);

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(TokenUpdated {
        token_mint: token_mint_key,
        min_amount: config.min_amount,
        enabled: config.enabled,
    });

    Ok(())
}
