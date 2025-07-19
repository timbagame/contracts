use crate::error::ErrorCode;
use crate::events::PlayerUnjoined;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let player_key = ctx.accounts.player.key();

    // ===============================
    // VALIDATION
    // ===============================

    // Check if oracle buffer time has expired (emergency unjoin only)
    require!(
        game.is_buffer_expired(oracle.oracle_buffer_time as u64, current_time),
        ErrorCode::OracleBufferNotExpired
    );

    require!(game.tickets_count > 0, ErrorCode::InvalidTicketsCount);

    // Verify player likely joined this game using bloom filter
    require!(
        game.player_likely_joined(&player_key),
        ErrorCode::UnauthorizedPlayer
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    // Simple unjoin - just decrement counters and refund
    // Note: We cannot remove from bloom filter without causing false negatives
    // for other players, so we just decrement counters
    game.tickets_count -= 1;
    game.total_amount -= game.ticket_amount;
    game.last_slot = clock.slot;

    // Refund player
    player_balance.refund(game.ticket_amount);

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        tickets_count: game.tickets_count,
        ticket_index: 0, // Not meaningful with bloom filter, but required by event
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}