use crate::{events::PlayerUnjoined, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_participation = &ctx.accounts.player_participation;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        !game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time),
        crate::error::ErrorCode::GameWaitingForOracle
    );

    require!(
        !(game.game_type == GameType::Snowball && game.players_count > 1),
        crate::error::ErrorCode::SnowballMultiPlayerUnjoin
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    let departing_index = player_participation.player_index;
    let last_index = game.players_count - 1;
    let refund_amount = player_participation.player_amount;

    // Swap departing player with last player if needed
    if departing_index != last_index {
        ctx.accounts.last_player_participation.player_index = departing_index;
    }

    // Process refund if player has contributed amount
    if refund_amount > 0 {
        game.total_amount -= refund_amount;
        ctx.accounts.player_balance.refund(refund_amount);
    }

    // Update game state
    game.players_count -= 1;
    game.last_slot = clock.slot;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: departing_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
