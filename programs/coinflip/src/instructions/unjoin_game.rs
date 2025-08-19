use crate::error::ErrorCode;
use crate::events::PlayerUnjoined;
use crate::utils::{get_current_slot, get_current_time, participant_hash};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
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

    // Find salted participant hash and remove if present (single ticket per player)
    let player_hash = participant_hash(&game.key(), &player_key);
    let removed_index_opt = game
        .participant_hashes
        .iter()
        .position(|h| *h == player_hash);
    if let Some(pos) = removed_index_opt {
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
        ticket_index: removed_index_opt.unwrap() as u32,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
