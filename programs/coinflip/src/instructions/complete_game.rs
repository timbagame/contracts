use crate::events::GameCompleted;
use crate::error::ErrorCode;
use crate::utils::get_current_time;
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::CompleteGame>,
    _random_hash: [u8; 32],
    secret_key: [u8; 32],
    winner_index: u32,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time),
        ErrorCode::GameNotReadyForOracle
    );

    // ===============================
    // WINNER VERIFICATION
    // ===============================

    // 1. Verify the winner index is correctly calculated from secret key
    let calculated_winner_index = game.calculate_winner_index(secret_key)
        .ok_or(ErrorCode::RandomnessGenerationFailed)?;
    require!(
        winner_index == calculated_winner_index,
        ErrorCode::InvalidWinnerIndex
    );

    // 2. Verify the winner index is within valid range
    require!(
        winner_index < game.tickets_count,
        ErrorCode::InvalidWinnerIndex
    );

    // Cross-validate winner in both Game and PlayerBalance filters
    let winner_key = ctx.accounts.winner.key();
    require!(
        game.check_participant_in_filter(&winner_key),
        ErrorCode::UnauthorizedPlayer
    );

    // Also validate against winner's PlayerBalance filters
    require!(
        !ctx.accounts.winner_balance.basic_can_join_game(&game.key(), game.created_at),
        ErrorCode::UnauthorizedPlayer
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
        tickets_count: game.tickets_count,
        winner_amount,
        fee_amount,
        timestamp: current_time,
    });

    Ok(())
}
