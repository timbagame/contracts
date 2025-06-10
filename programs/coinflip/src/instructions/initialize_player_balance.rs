use crate::events::PlayerBalanceInitialized;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializePlayerBalance>) -> Result<()> {
    // ===============================
    // EFFECTS - Update state
    // ===============================
    let player_balance = &mut ctx.accounts.player_balance;
    let player = &ctx.accounts.player;
    let token_mint = &ctx.accounts.token_mint;

    player_balance.amount = 0;

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(PlayerBalanceInitialized {
        player: player.key(),
        token_mint: token_mint.key(),
    });

    Ok(())
}
