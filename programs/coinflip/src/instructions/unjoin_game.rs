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

    // Late unjoin only allowed after: (timeout + oracle buffer). Prevents strategic exits.
    require!(
        game.is_buffer_expired(oracle.oracle_buffer_time, current_time),
        ErrorCode::OracleBufferNotExpired
    );

    // No need to check completion explicitly: completed games are closed (see CompleteGame: close = creator)

    require!(game.tickets_count > 0, ErrorCode::InvalidTicketsCount);

    // ===============================
    // STATE UPDATES
    // ===============================

    // Find participant hash and remove if present (single ticket per player)
    let hash_bytes = anchor_lang::solana_program::hash::hash(player_key.as_ref()).to_bytes();
    let participant_hash = u64::from_le_bytes(hash_bytes[0..8].try_into().unwrap());
    if let Some(pos) = game
        .participant_hashes
        .iter()
        .position(|h| *h == participant_hash)
    {
        game.participant_hashes.swap_remove(pos);
        // Decrement counters and refund
        game.tickets_count -= 1;
        game.total_amount -= game.ticket_amount;
    } else {
        return err!(ErrorCode::UnauthorizedPlayer);
    }
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
