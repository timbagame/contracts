use crate::error::ErrorCode;
use crate::events::GameCompleted;
use crate::utils::get_current_time;
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::CompleteGame>,
    _random_hash: [u8; 32],
    secret_key: [u8; 32],
    winner_index: u32,
) -> Result<()> {
    let vault_bump = ctx.bumps.game_vault_ctx.game_vault;
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;

    require!(
        game.waiting_for_oracle(oracle.oracle_buffer_time, current_time),
        ErrorCode::GameNotReadyForOracle
    );

    // 1. Recompute winner index deterministically from secret key + game state (append order canonical)
    let calculated_winner_index = game
        .calculate_winner_index(secret_key)
        .ok_or(ErrorCode::RandomnessGenerationFailed)?;
    require!(
        winner_index == calculated_winner_index,
        ErrorCode::WinnerIndexMismatch
    );

    // 2. Bounds check: ensure index < tickets_count
    require!(
        winner_index < game.tickets_count,
        ErrorCode::WinnerIndexOutOfRange
    );

    // 3. Direct positional identity check: append order is canonical participant ordering
    let winner_key = ctx.accounts.winner.key();

    // Safety: participants length should equal tickets_count; rely on index already checked
    let expected_winner = game.participants[winner_index as usize];
    require!(
        expected_winner == winner_key,
        ErrorCode::WinnerPubkeyMismatch
    );

    let (winner_amount, fee_amount) = game.calculate_amounts(oracle.fee_percentage);

    // Mark game as completed
    game.complete();

    // Transfer winner amount directly to winner's token account
    ctx.accounts.game_vault_ctx.transfer_from_vault(
        &ctx.accounts.winner_token_account,
        winner_amount,
        vault_bump,
    )?;

    // Transfer the live Oracle fee directly to the current Oracle operator.
    ctx.accounts.game_vault_ctx.transfer_from_vault(
        &ctx.accounts.oracle_operator_token_account,
        fee_amount,
        vault_bump,
    )?;

    emit!(GameCompleted::new(
        game,
        ctx.accounts.winner.key(),
        winner_amount,
        fee_amount,
        current_time,
    ));

    Ok(())
}
