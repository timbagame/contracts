use crate::events::PlayerParticipationCleaned;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CleanPlayerParticipation>) -> Result<()> {
    // ===============================
    // CHECKS
    // ===============================
    let game = &mut ctx.accounts.game;
    let player_participation = &ctx.accounts.player_participation;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    // Only allow cleanup if:
    // 1. Game is completed (total_amount == 0), OR
    // 2. Buffer time has expired (game can no longer be completed)
    let is_completed = game.total_amount == 0;
    let is_buffer_expired = game.is_buffer_expired(oracle.oracle_buffer_time as u64, current_time);
    let can_cleanup = is_completed || is_buffer_expired;

    require!(can_cleanup, crate::error::ErrorCode::GameWaitingForOracle);

    // ===============================
    // EFFECTS - Update state first
    // ===============================
    let refund_amount =
        if is_buffer_expired && !is_completed && player_participation.player_amount > 0 {
            // Refund player for uncompleted game
            let player_balance = &mut ctx.accounts.player_balance;
            player_balance.refund(player_participation.player_amount);

            // Deduct from game's total amount
            game.total_amount -= player_participation.player_amount;
            player_participation.player_amount
        } else {
            0
        };

    // Decrement player count
    game.players_count -= 1;

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(PlayerParticipationCleaned {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: player_participation.player_index,
        refund_amount,
        is_completed_game: is_completed,
        timestamp: current_time,
    });

    Ok(())
}
