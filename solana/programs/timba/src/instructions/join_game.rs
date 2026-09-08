use crate::error::ErrorCode;
use crate::events::PlayerJoined;
use crate::utils::get_clock_snapshot;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let (current_time, current_slot) = get_clock_snapshot()?;
    let player_key = ctx.accounts.player.key();

    require!(!game.is_expired(current_time), ErrorCode::GameExpired);

    // Duplicate prevention: scan the exact participant list.
    require!(
        !game.contains_participant(&player_key),
        ErrorCode::AlreadyJoined
    );

    // Add player to game and update counters
    let ticket_index = game.add_player_to_game(player_key)?;
    game.last_slot = current_slot;

    ctx.accounts.game_vault_ctx.transfer_from_player(
        &ctx.accounts.player_token_account,
        &ctx.accounts.player,
        game.ticket_amount,
    )?;

    emit!(PlayerJoined::new(
        game,
        player_key,
        ticket_index,
        current_slot,
        current_time,
    ));

    Ok(())
}
