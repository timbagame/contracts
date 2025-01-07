use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializeToken>,
    ticker: String,
    min_amount: u64,
    enabled: bool,
) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.ticker = ticker;
    game_token.token_mint = ctx.accounts.token_mint.key();
    game_token.token_account = ctx.accounts.token_account.key();
    game_token.vault = ctx.accounts.vault.key();
    game_token.bump = ctx.bumps.vault;
    game_token.min_amount = min_amount;
    game_token.fee_amount = 0;
    game_token.enabled = enabled;

    Ok(())
}
