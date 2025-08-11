use crate::error::ErrorCode;
use crate::events::PlayerUnjoined;
use crate::utils::{get_current_slot, get_current_time};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>, ticket_index: u32) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;
    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;
    let player_key = ctx.accounts.player.key();

    // ===============================
    // VALIDATION
    // ===============================

    // Check if oracle buffer time has expired (emergency unjoin only)
    require!(
        game.is_buffer_expired(oracle.oracle_buffer_time, current_time),
        ErrorCode::OracleBufferNotExpired
    );

    require!(game.tickets_count > 0, ErrorCode::InvalidTicketsCount);

    // Check if emergency mode should be activated (timer-based)
    player_balance.maybe_activate_emergency_mode(current_time);

    // Unjoin validation with emergency mode support
    require!(
        player_balance.can_unjoin_game(&game.key(), &player_key, ticket_index, &game),
        ErrorCode::UnauthorizedPlayer
    );

    // Prevent double unjoining (only in normal mode - emergency mode is more permissive)
    if !player_balance.emergency_unjoin_mode {
        require!(
            !player_balance.has_unjoined_game_index(&game.key(), ticket_index, game.created_at),
            ErrorCode::AlreadyJoined // Reusing error - player already processed this unjoin
        );
    }

    // ===============================
    // STATE UPDATES
    // ===============================

    // Simple unjoin - just decrement counters and refund
    // Note: We cannot remove from bloom filter without causing false negatives
    // for other players, so we just decrement counters
    game.tickets_count -= 1;
    game.total_amount -= game.ticket_amount;
    game.last_slot = get_current_slot()?;

    // Refund player directly
    if game.ticket_amount > 0 {
        ctx.accounts.game_token.handle_pda_token_transfer(
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_vault.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            game.ticket_amount,
        )?;
    }

    // Track this unjoin in bloom filter to prevent double unjoining
    player_balance.mark_game_index_unjoined(&game.key(), ticket_index, current_time);

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        tickets_count: game.tickets_count,
        ticket_index, // Actual ticket index being unjoined
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
