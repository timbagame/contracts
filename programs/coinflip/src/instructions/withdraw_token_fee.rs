use crate::events::TokenFeeWithdrawn;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawTokenFee>) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let authority_key = ctx.accounts.authority.key();
    let token_mint_key = ctx.accounts.token_mint.key();
    let withdrawal_amount = game_token.fee_amount;

    // ===============================
    // STATE UPDATES
    // ===============================

    game_token.fee_amount = 0;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    game_token.handle_pda_token_transfer(
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.authority_token_account.to_account_info(),
        ctx.accounts.game_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        withdrawal_amount,
    )?;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(TokenFeeWithdrawn {
        authority: authority_key,
        token_mint: token_mint_key,
        amount: withdrawal_amount,
    });

    Ok(())
}
