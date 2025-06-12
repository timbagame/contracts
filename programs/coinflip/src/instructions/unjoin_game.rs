use crate::{events::PlayerUnjoined, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    // ===============================
    // CHECKS
    // ===============================
    let game = &mut ctx.accounts.game;
    let player_participation = &ctx.accounts.player_participation;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    // Block unjoin if game is waiting for oracle
    require!(
        !game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time),
        crate::error::ErrorCode::GameWaitingForOracle
    );

    // For Snowball games, only allow if there is only one player
    require!(
        !(game.game_type == GameType::Snowball && game.players_count > 1),
        crate::error::ErrorCode::SnowballMultiPlayerUnjoin
    );

    // ===============================
    // EFFECTS - Update all state first
    // ===============================
    // Get the departing player's index
    let departing_index = player_participation.player_index;
    let last_index = game.players_count - 1;

    // If departing player is not the last player, we need to swap with the last player
    if departing_index != last_index {
        let last_player_participation = &mut ctx.accounts.last_player_participation;
        last_player_participation.player_index = departing_index;
    }

    let should_refund = player_participation.player_amount > 0;
    let refund_amount = player_participation.player_amount;

    // Update game state
    if should_refund {
        game.total_amount -= refund_amount;
    }
    game.players_count -= 1;
    game.last_slot = clock.slot;

    // Update player balance if refund is needed
    if should_refund {
        let player_balance = &mut ctx.accounts.player_balance;
        player_balance.refund(refund_amount);
    }

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Emit event
    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: player_participation.player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
