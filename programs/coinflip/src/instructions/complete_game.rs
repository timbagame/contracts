use crate::events::GameCompleted;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CompleteGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time),
        crate::error::ErrorCode::GameNotReadyForOracle
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    let fee_percentage = oracle.fee_percentage as u64;
    let (winner_amount, fee_amount) = game.calculate_amounts(fee_percentage);

    // Update balances
    ctx.accounts.game_token.fee_amount += fee_amount;
    ctx.accounts.winner_balance.amount += winner_amount;

    // Mark game as completed
    game.complete();

    // ===============================
    // EVENT EMISSION
    // ===============================

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
