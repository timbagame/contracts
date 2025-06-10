use crate::{events::PlayerBalanceWithdrawn, utils::handle_pda_token_transfer};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawPlayerBalance>) -> Result<()> {
    // ===============================
    // CHECKS (handled by constraints)
    // ===============================

    // ===============================
    // EFFECTS - Update state first
    // ===============================
    let player_balance = &mut ctx.accounts.player_balance;
    let withdrawal_amount = player_balance.amount;

    // Clear the balance
    player_balance.amount = 0;

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Transfer tokens from game vault to player
    handle_pda_token_transfer(
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.player_token_account.to_account_info(),
        ctx.accounts.game_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.token_mint.key(),
        ctx.bumps.game_vault,
        withdrawal_amount,
    )?;

    // Emit event
    emit!(PlayerBalanceWithdrawn {
        player: ctx.accounts.player.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount: withdrawal_amount,
    });

    Ok(())
}
