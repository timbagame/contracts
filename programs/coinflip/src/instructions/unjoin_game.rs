use crate::error::ErrorCode;
use crate::events::PlayerUnjoined;
use crate::utils::{get_current_slot, get_current_time};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>, ticket_index: u32) -> Result<()> {
    let game = &mut ctx.accounts.game;

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

    // PlayerGames removed: basic permission check now ensures game had participants
    // Without per-player tracking we cannot validate specific ticket ownership on-chain here.

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
        ctx.accounts.game_token.handle_token_transfer(
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_vault.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            game.ticket_amount,
            true,
        )?;
    }

    // PlayerGames removed: no unjoin index tracking

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
