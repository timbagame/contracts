use crate::{
    error::ErrorCode::{
        GameWaitingForOracle, OnlyLastPlayerCanUnjoin, SameSlotReuse, SnowballMultiPlayerUnjoin,
    },
    events::PlayerUnjoined,
    state::GameType,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let player_participation = &ctx.accounts.player_participation;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    // Check if this is a cleanup operation for a completed game
    if game.is_completed_but_not_cleaned() {
        // This is a cleanup operation - just decrement players count
        game.players_count -= 1;
        return Ok(());
    }

    // This is an active unjoin operation - perform all validation checks

    // Block unjoin if game is waiting for oracle
    if game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time) {
        return Err(GameWaitingForOracle.into());
    }

    // If it is a Snowball game, only allow if there is only one player
    if game.game_type == GameType::Snowball && game.players_count > 1 {
        return Err(SnowballMultiPlayerUnjoin.into());
    }

    // CRITICAL FIX: Only allow the last player to unjoin to prevent index gaps
    // This ensures winner calculation always works correctly
    if player_participation.player_index != (game.players_count - 1) {
        return Err(OnlyLastPlayerCanUnjoin.into());
    }

    // Return funds if player contributed any amount
    if player_participation.player_amount > 0 {
        if let Some(player_balance) = &mut ctx.accounts.player_balance {
            player_balance.refund(player_participation.player_amount);
            game.total_amount -= player_participation.player_amount;
        }
    }

    // Decrement player count
    game.players_count -= 1;

    // Ensure we're not reusing the same slot
    if clock.slot == game.last_slot {
        return Err(SameSlotReuse.into());
    }
    game.last_slot = clock.slot;

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
