use crate::events::TokenFeeWithdrawn;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawTokenFee>) -> Result<()> {
    let operator_key = ctx.accounts.oracle_operator.key();
    let token_mint = &ctx.accounts.game_token_ctx.token_mint;
    let token_mint_key = token_mint.key();
    let withdrawal_amount = ctx.accounts.game_token_ctx.game_token.fee_amount;

    // ===============================
    // STATE UPDATES
    // ===============================

    {
        let game_token = &mut ctx.accounts.game_token_ctx.game_token;
        game_token.fee_amount = 0;
    }

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    ctx.accounts.game_token_ctx.transfer_from_vault(
        &ctx.accounts.game_token_ctx.game_token,
        &ctx.accounts.oracle_operator_token_account,
        withdrawal_amount,
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
