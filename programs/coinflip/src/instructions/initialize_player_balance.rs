use crate::events::PlayerBalanceInitialized;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializePlayerBalance>) -> Result<()> {
    // ===============================
    // CHECKS (handled by constraints)
    // ===============================

    // ===============================
    // EFFECTS - Update state
    // ===============================
    let player_balance = &mut ctx.accounts.player_balance;
    player_balance.amount = 0;

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(PlayerBalanceInitialized {
        player: ctx.accounts.player.key(),
        token_mint: ctx.accounts.token_mint.key(),
    });

    Ok(())
}
