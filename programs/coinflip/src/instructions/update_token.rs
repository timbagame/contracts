use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::UpdateToken>,
    min_amount: u64,
    enabled: bool,
) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    game_token.min_amount = min_amount;
    game_token.enabled = enabled;

    Ok(())
}
