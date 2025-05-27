use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawTokenFee>) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let fee_amount = game_token.fee_amount;
    game_token.fee_amount = 0;

    crate::state::handle_pda_token_transfer(
        &ctx.accounts.game_token_account.to_account_info(),
        &ctx.accounts.authority_token_account.to_account_info(),
        &ctx.accounts.game_vault.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.token_mint.key(),
        ctx.bumps.game_vault,
        fee_amount,
    )?;

    Ok(())
}
