use crate::error::ErrorCode;
use crate::events::PlayerUnjoined;
use crate::utils::get_clock_snapshot;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    let oracle = &ctx.accounts.oracle;
    let (current_time, current_slot) = get_clock_snapshot()?;
    let player_key = ctx.accounts.player.key();

    // ===============================
    // VALIDATION
    // ===============================

    // Allow unjoin once the buffer elapsed or the game no longer needs the oracle.
    require!(
        game.can_unjoin(oracle.oracle_buffer_time, current_time),
        ErrorCode::OracleBufferNotExpired
    );

    // No need to check completion explicitly: completed games are closed (see CompleteGame: close = creator)

    // ===============================
    // STATE UPDATES
    // ===============================

    // Find and remove the exact participant (single ticket per player).
    let removed_index = game.remove_participant(&player_key)?;
    game.last_slot = current_slot;

    // Refund player directly
    ctx.accounts
        .game_token_ctx
        .transfer_from_vault(&ctx.accounts.player_token_account, game.ticket_amount)?;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerUnjoined::new(
        game,
        player_key,
        removed_index as u32,
        current_slot,
        current_time,
    ));

    Ok(())
}
