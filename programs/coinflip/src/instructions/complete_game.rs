use crate::{error::ErrorCode::GameNotReadyForOracle, events::GameCompleted};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CompleteGame>) -> Result<()> {
    // ===============================
    // CHECKS
    // ===============================
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // Block completion if game is not waiting for oracle
    if !game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time) {
        return Err(GameNotReadyForOracle.into());
    }

    // ===============================
    // EFFECTS - Update all state first
    // ===============================
    let game_token = &mut ctx.accounts.game_token;
    let winner_balance = &mut ctx.accounts.winner_balance;
    let fee_percentage = oracle.fee_percentage as u64;
    let (winner_amount, fee_amount) = game.calculate_amounts(fee_percentage);

    // Update balances
    game_token.fee_amount += fee_amount;
    winner_balance.amount += winner_amount;

    // Mark game as completed (but don't close it yet)
    game.complete();

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(GameCompleted {
        game_key: game.key(),
        winner: ctx.accounts.winner.key(),
        players_count: game.players_count,
        winner_amount,
        fee_amount,
        timestamp: current_time,
    });

    Ok(())
}
