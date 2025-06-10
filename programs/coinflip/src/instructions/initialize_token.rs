use crate::{events::TokenInitialized, TokenConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeToken>, config: TokenConfig) -> Result<()> {
    // ===============================
    // CHECKS (handled by constraints)
    // ===============================

    // ===============================
    // EFFECTS - Update state
    // ===============================
    let game_token = &mut ctx.accounts.game_token;
    let token_mint = &ctx.accounts.token_mint;

    game_token.initialize(config.min_amount, config.enabled);

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(TokenInitialized {
        token_mint: token_mint.key(),
        min_amount: config.min_amount,
        enabled: config.enabled,
    });

    Ok(())
}
