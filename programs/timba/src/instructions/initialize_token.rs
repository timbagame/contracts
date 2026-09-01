use crate::events::TokenInitialized;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeToken>) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let token_mint_key = ctx.accounts.token_mint.key();

    game_token.initialize(token_mint_key, ctx.bumps.game_vault);

    emit!(TokenInitialized::new(token_mint_key));

    Ok(())
}
