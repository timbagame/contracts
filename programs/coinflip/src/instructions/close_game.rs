use crate::error::ErrorCode;
use crate::events::GameClosed;
use crate::utils::get_current_time;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CloseGame>) -> Result<()> {
    let game = &ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        !game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time),
        ErrorCode::GameWaitingForOracle
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    // Refund creator for giveaway games with remaining funds
    if game.ticket_amount == 0 && game.total_amount > 0 {
        ctx.accounts.creator_balance.refund(game.total_amount);
    }

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(GameClosed {
        game_key: game.key(),
        timestamp: current_time,
    });

    Ok(())
}
