use crate::{events::PlayerBalanceWithdrawn, utils::handle_pda_token_transfer};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawPlayerBalance>) -> Result<()> {
    let player_balance = &mut ctx.accounts.player_balance;
    let player_key = ctx.accounts.player.key();
    let token_mint_key = ctx.accounts.token_mint.key();
    let withdrawal_amount = player_balance.amount;

    // ===============================
    // STATE UPDATES
    // ===============================

    player_balance.amount = 0;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    handle_pda_token_transfer(
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.player_token_account.to_account_info(),
        ctx.accounts.game_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        token_mint_key,
        ctx.bumps.game_vault,
        withdrawal_amount,
    )?;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerBalanceWithdrawn {
        player: player_key,
        token_mint: token_mint_key,
        amount: withdrawal_amount,
    });

    Ok(())
}
