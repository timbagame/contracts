use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializePlayerToken>) -> Result<()> {
    let player_token = &mut ctx.accounts.player_token;
    player_token.player = ctx.accounts.player.key();
    player_token.token_mint = ctx.accounts.game_token.token_mint;
    player_token.token_account = ctx.accounts.token_account.key();
    player_token.amount = 0;

    Ok(())
}
