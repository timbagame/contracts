use crate::utils::handle_pda_token_transfer;
use anchor_lang::prelude::*;

#[event]
pub struct PlayerBalanceWithdrawn {
    pub player: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

pub fn handler(ctx: Context<super::WithdrawPlayerBalance>) -> Result<()> {
    let player_balance = &mut ctx.accounts.player_balance;
    let amount = player_balance.amount;
    player_balance.amount = 0;

    handle_pda_token_transfer(
        &ctx.accounts.game_token_account.to_account_info(),
        &ctx.accounts.player_token_account.to_account_info(),
        &ctx.accounts.game_vault.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.token_mint.key(),
        ctx.bumps.game_vault,
        amount,
    )?;

    emit!(PlayerBalanceWithdrawn {
        player: ctx.accounts.player.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
