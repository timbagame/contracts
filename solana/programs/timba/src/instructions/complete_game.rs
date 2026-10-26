use crate::error::ErrorCode;
use crate::events::GameCompleted;
use crate::utils::get_clock_snapshot;
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::CompleteGame>,
    secret_key: [u8; 32],
    winner_index: u32,
) -> Result<()> {
    let vault_bump = ctx.bumps.game_vault_ctx.game_vault;
    let game = &ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let (current_time, _) = get_clock_snapshot()?;

    require!(
        game.waiting_for_oracle(oracle.oracle_buffer_time, current_time),
        ErrorCode::GameNotReadyForOracle
    );

    // Reject an out-of-bounds input before comparing it with the derived winner.
    // Comparing first makes WinnerIndexOutOfRange unreachable for every input.
    let expected_winner = *game
        .participants
        .get(winner_index as usize)
        .ok_or(ErrorCode::WinnerIndexOutOfRange)?;

    // Recompute the winner index from the revealed secret and the game state.
    let calculated_winner_index = game
        .calculate_winner_index(secret_key)
        .ok_or(ErrorCode::RandomnessGenerationFailed)?;
    require!(
        winner_index == calculated_winner_index,
        ErrorCode::WinnerIndexMismatch
    );

    // Participant order is canonical, so the index identifies exactly one winner.
    let winner_key = ctx.accounts.winner.key();
    require!(
        expected_winner == winner_key,
        ErrorCode::WinnerPubkeyMismatch
    );

    let (winner_amount, fee_amount) = game.calculate_amounts(oracle.fee_percentage);

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
        winner_key,
        winner_amount,
        fee_amount,
        current_time,
    ));

    Ok(())
}
