use crate::error::ErrorCode;
use crate::events::PlayerJoined;
use crate::utils::{get_clock_snapshot, participant_hash};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let (current_time, current_slot) = get_clock_snapshot()?;
    let player_key = ctx.accounts.player.key();

    // ===============================
    // VALIDATION
    // ===============================

    require!(!game.is_expired(current_time), ErrorCode::GameExpired);

    // Duplicate prevention: scan exact salted hash list (per-game uniqueness)
    let player_hash = participant_hash(&game.key(), &player_key);
    require!(
        !game.contains_participant(player_hash),
        ErrorCode::AlreadyJoined
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    // Add player to game and update counters
    let ticket_index = game.add_player_to_game(player_hash)?;
    game.last_slot = current_slot;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    ctx.accounts.game_token_ctx.transfer_from_player(
        &ctx.accounts.player_token_account,
        &ctx.accounts.player,
        game.ticket_amount,
    )?;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerJoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        tickets_count: game.tickets_count,
        ticket_index,
        last_slot: current_slot,
        timestamp: current_time,
    });

    Ok(())
}
