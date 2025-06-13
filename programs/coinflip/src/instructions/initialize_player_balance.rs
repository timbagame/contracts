use crate::events::PlayerBalanceInitialized;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializePlayerBalance>) -> Result<()> {
    let player_balance = &mut ctx.accounts.player_balance;
    let player_key = ctx.accounts.player.key();
    let token_mint_key = ctx.accounts.token_mint.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    player_balance.amount = 0;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerBalanceInitialized {
        player: player_key,
        token_mint: token_mint_key,
    });

    Ok(())
}
