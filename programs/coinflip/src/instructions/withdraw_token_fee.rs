use crate::utils::handle_pda_token_transfer;
use anchor_lang::prelude::*;

#[event]
pub struct TokenFeeWithdrawn {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

pub fn handler(ctx: Context<super::WithdrawTokenFee>) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let fee_amount = game_token.fee_amount;
    game_token.fee_amount = 0;

    handle_pda_token_transfer(
        &ctx.accounts.game_token_account.to_account_info(),
        &ctx.accounts.authority_token_account.to_account_info(),
        &ctx.accounts.game_vault.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.token_mint.key(),
        ctx.bumps.game_vault,
        fee_amount,
    )?;

    emit!(TokenFeeWithdrawn {
        authority: ctx.accounts.authority.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount: fee_amount,
    });

    Ok(())
}
