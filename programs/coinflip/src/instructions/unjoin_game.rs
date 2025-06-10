use crate::{
    error::ErrorCode::{GameWaitingForOracle, OnlyLastPlayerCanUnjoin, SnowballMultiPlayerUnjoin},
    events::PlayerUnjoined,
    state::GameType,
};
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
    if game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time) {
        return Err(GameWaitingForOracle.into());
    }

    // For Snowball games, only allow if there is only one player
    if game.game_type == GameType::Snowball && game.players_count > 1 {
        return Err(SnowballMultiPlayerUnjoin.into());
    }

    // CRITICAL: Only allow the last player to unjoin to prevent index gaps
    if player_participation.player_index != (game.players_count - 1) {
        return Err(OnlyLastPlayerCanUnjoin.into());
    }

    // ===============================
    // EFFECTS - Update all state first
    // ===============================
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
        if let Some(player_balance) = &mut ctx.accounts.player_balance {
            player_balance.refund(refund_amount);
        }
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
