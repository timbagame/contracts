use crate::error::ErrorCode;
use crate::events::GameCompleted;
use crate::utils::get_current_time;
use crate::utils::participant_hash;
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
        game.waiting_for_oracle(oracle.oracle_buffer_time, current_time),
        ErrorCode::GameNotReadyForOracle
    );

    // ===============================
    // WINNER VERIFICATION
    // ===============================

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

    // 3. Direct positional hash check: append order is canonical participant ordering
    let winner_key = ctx.accounts.winner.key();
    let supplied_hash = participant_hash(&game.key(), &winner_key);

    // Safety: participant_hashes length should equal tickets_count; rely on index already checked
    let expected_hash = game.participant_hashes[winner_index as usize];
    require!(
        expected_hash == supplied_hash,
        ErrorCode::WinnerPubkeyHashMismatch
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    let fee_percentage = oracle.fee_percentage as u64;
    let (winner_amount, fee_amount) = game.calculate_amounts(fee_percentage);

    // Update fee amount and transfer directly to winner
    let new_fee_total = ctx
        .accounts
        .game_token
        .fee_amount
        .checked_add(fee_amount)
        .ok_or(ErrorCode::InvalidAmount)?;
    ctx.accounts.game_token.fee_amount = new_fee_total;

    // Mark game as completed
    game.complete();

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    // Transfer winner amount directly to winner's token account
    ctx.accounts.game_token.handle_token_transfer(
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.winner_token_account.to_account_info(),
        ctx.accounts.game_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        winner_amount,
        ctx.accounts.token_mint.decimals,
        true,
    )?;

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
