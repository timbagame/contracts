use crate::{error::ErrorCode::GameWaitingForOracle, events::GameClosed};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CloseGame>) -> Result<()> {
    // ===============================
    // CHECKS
    // ===============================
    let game = &ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // Block close if game is ready for oracle
    if game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time) {
        return Err(GameWaitingForOracle.into());
    }

    // ===============================
    // EFFECTS - Update state first
    // ===============================

    // Refund creator for giveaway games with remaining funds
    if game.ticket_amount == 0 && game.total_amount > 0 {
        if let Some(creator_balance) = &mut ctx.accounts.creator_balance {
            creator_balance.refund(game.total_amount);
        }
    }

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(GameClosed {
        game_key: game.key(),
        timestamp: current_time,
    });

    Ok(())
}
