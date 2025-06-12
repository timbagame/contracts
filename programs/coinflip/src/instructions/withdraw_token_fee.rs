use crate::{events::TokenFeeWithdrawn, utils::handle_pda_token_transfer};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawTokenFee>) -> Result<()> {
    // ===============================
    // EFFECTS - Update state first
    // ===============================
    let game_token = &mut ctx.accounts.game_token;
    let authority = &ctx.accounts.authority;
    let token_mint = &ctx.accounts.token_mint;
    let withdrawal_amount = game_token.fee_amount;

    // Clear the fee amount
    game_token.fee_amount = 0;

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Transfer tokens from game vault to authority
    handle_pda_token_transfer(
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.authority_token_account.to_account_info(),
        ctx.accounts.game_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        token_mint.key(),
        ctx.bumps.game_vault,
        withdrawal_amount,
    )?;

    // Emit event
    emit!(TokenFeeWithdrawn {
        authority: authority.key(),
        token_mint: token_mint.key(),
        amount: withdrawal_amount,
    });

    Ok(())
}
