use crate::events::GameCompleted;
use crate::error::ErrorCode;
use crate::state::{Game, ParticipationEntry};
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::CompleteGame>,
    _random_hash: [u8; 32],
    secret_key: [u8; 32],
    winner_participation: ParticipationEntry,
    winner_merkle_proof: Vec<[u8; 32]>,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = Clock::get()?.unix_timestamp as u64;

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

    // 1. Verify the winner participation entry (subtree or recent player)
    let winner_leaf = Game::hash_participation_entry(&winner_participation);
    require!(
        game.verify_player_participation(
            winner_leaf,
            &winner_merkle_proof,
            winner_participation.player_index,
        ),
        ErrorCode::InvalidMerkleProof
    );

    // 2. Verify the winner index is correctly calculated from secret key
    let calculated_winner_index = game.calculate_winner_index(secret_key);
    require!(
        winner_participation.player_index == calculated_winner_index,
        ErrorCode::InvalidWinnerIndex
    );

    // 3. Verify the winner's pubkey matches the account provided
    require!(
        winner_participation.player == ctx.accounts.winner.key(),
        ErrorCode::WinnerPubkeyMismatch
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
