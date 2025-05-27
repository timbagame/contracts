use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::WithdrawPlayerBalance>) -> Result<()> {
    let player_balance = &mut ctx.accounts.player_balance;
    let amount = player_balance.amount;
    player_balance.amount = 0;

    crate::state::handle_pda_token_transfer(
        &ctx.accounts.game_token_account.to_account_info(),
        &ctx.accounts.player_token_account.to_account_info(),
        &ctx.accounts.game_vault.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.token_mint.key(),
        ctx.bumps.game_vault,
        amount,
    )?;

    Ok(())
}
