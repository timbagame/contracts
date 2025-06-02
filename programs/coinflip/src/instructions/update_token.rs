use crate::TokenConfig;
use anchor_lang::prelude::*;

#[event]
pub struct TokenUpdated {
    pub token_mint: Pubkey,
    pub min_amount: u64,
    pub enabled: bool,
}

pub fn handler(ctx: Context<super::UpdateToken>, config: TokenConfig) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.update_config(config.min_amount, config.enabled);

    emit!(TokenUpdated {
        token_mint: ctx.accounts.token_mint.key(),
        min_amount: config.min_amount,
        enabled: config.enabled,
    });

    Ok(())
}
