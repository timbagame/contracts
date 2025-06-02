use anchor_lang::prelude::*;

#[event]
pub struct PlayerBalanceInitialized {
    pub player: Pubkey,
    pub token_mint: Pubkey,
}

pub fn handler(ctx: Context<super::InitializePlayerBalance>) -> Result<()> {
    let player_balance = &mut ctx.accounts.player_balance;
    player_balance.player = ctx.accounts.player.key();
    player_balance.token_mint = ctx.accounts.game_token.token_mint;
    player_balance.amount = 0;

    emit!(PlayerBalanceInitialized {
        player: ctx.accounts.player.key(),
        token_mint: ctx.accounts.game_token.token_mint,
    });

    Ok(())
}
