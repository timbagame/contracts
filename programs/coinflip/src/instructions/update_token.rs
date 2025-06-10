use crate::{events::TokenUpdated, TokenConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateToken>, config: TokenConfig) -> Result<()> {
    // ===============================
    // CHECKS (handled by constraints)
    // ===============================

    // ===============================
    // EFFECTS - Update state
    // ===============================
    let game_token = &mut ctx.accounts.game_token;
    game_token.update_config(config.min_amount, config.enabled);

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(TokenUpdated {
        token_mint: ctx.accounts.token_mint.key(),
        min_amount: config.min_amount,
        enabled: config.enabled,
    });

    Ok(())
}
