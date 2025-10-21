use crate::events::TokenFeeWithdrawn;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawTokenFee>) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token_ctx.game_token;
    let operator_key = ctx.accounts.oracle_operator.key();
    let token_mint = &ctx.accounts.game_token_ctx.token_mint;
    let token_mint_key = token_mint.key();
    let withdrawal_amount = game_token.fee_amount;

    // ===============================
    // STATE UPDATES
    // ===============================

    game_token.fee_amount = 0;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    game_token.handle_token_transfer(
        ctx.accounts
            .game_token_ctx
            .game_token_account
            .to_account_info(),
        ctx.accounts.oracle_operator_token_account.to_account_info(),
        ctx.accounts.game_token_ctx.game_vault.to_account_info(),
        ctx.accounts.game_token_ctx.token_program.to_account_info(),
        token_mint.to_account_info(),
        withdrawal_amount,
        token_mint.decimals,
        true,
    )?;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(TokenFeeWithdrawn {
        operator: operator_key,
        token_mint: token_mint_key,
        amount: withdrawal_amount,
    });

    Ok(())
}
