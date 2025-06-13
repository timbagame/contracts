use crate::events::GameClosed;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CloseGame>) -> Result<()> {
    let game = &ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        !game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time),
        crate::error::ErrorCode::GameWaitingForOracle
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
