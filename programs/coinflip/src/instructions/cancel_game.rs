use crate::{error::ErrorCode::GameWaitingForOracle, events::GameCancelled};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    // ===============================
    // CHECKS
    // ===============================
    let game = &ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // Check if this is a cleanup operation for a completed game
    if game.is_completed_but_not_cleaned() {
        return Ok(());
    }

    // Active cancellation operation - perform validation checks
    // Block cancellation if game is ready for oracle
    if game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time) {
        return Err(GameWaitingForOracle.into());
    }

    // ===============================
    // EFFECTS - Update state first
    // ===============================

    // Refund creator for giveaway games (ticket_amount == 0)
    if game.ticket_amount == 0 {
        if let Some(creator_balance) = &mut ctx.accounts.creator_balance {
            creator_balance.refund(game.total_amount);
        }
    }

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(GameCancelled {
        game_key: game.key(),
        timestamp: current_time,
    });

    Ok(())
}
