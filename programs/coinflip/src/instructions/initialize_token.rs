use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializeToken>,
    min_amount: u64,
    enabled: bool,
) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.token_mint = ctx.accounts.token_mint.key();
    game_token.min_amount = min_amount;
    game_token.fee_amount = 0;
    game_token.enabled = enabled;

    Ok(())
}
