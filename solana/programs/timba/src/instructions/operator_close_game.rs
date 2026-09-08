use crate::error::ErrorCode;
use crate::events::OperatorGameClosed;
use crate::utils::get_current_time;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::OperatorCloseGame>) -> Result<()> {
    let vault_bump = ctx.bumps.game_vault_ctx.game_vault;
    let game = &ctx.accounts.game;
    let current_time = get_current_time()?;

    require!(
        game.is_buffer_expired(ctx.accounts.oracle.oracle_buffer_time, current_time),
        ErrorCode::GameCleanupNotAvailable
    );

    let refunded_amount = if game.ticket_amount == 0 {
        game.total_amount
    } else {
        0
    };
    if refunded_amount > 0 {
        ctx.accounts.game_vault_ctx.transfer_from_vault(
            &ctx.accounts.creator_token_account,
            refunded_amount,
            vault_bump,
        )?;
    }

    emit!(OperatorGameClosed::new(
        game,
        ctx.accounts.oracle_operator.key(),
        refunded_amount,
        game.to_account_info().lamports(),
        current_time,
    ));

    Ok(())
}
