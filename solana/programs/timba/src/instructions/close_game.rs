use crate::error::ErrorCode;
use crate::events::GameClosed;
use crate::utils::get_current_time;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CloseGame>) -> Result<()> {
    let vault_bump = ctx.bumps.game_vault_ctx.game_vault;
    let game = &ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;

    let is_empty = game.tickets_count == 0;
    require!(
        is_empty || game.can_unjoin(oracle.oracle_buffer_time, current_time),
        ErrorCode::GameWaitingForOracle
    );

    // Refund creator for giveaway games with remaining funds
    if game.ticket_amount == 0 && game.total_amount > 0 {
        ctx.accounts.game_vault_ctx.transfer_from_vault(
            &ctx.accounts.creator_token_account,
            game.total_amount,
            vault_bump,
        )?;
    }

    emit!(GameClosed::new(game, current_time));

    Ok(())
}
