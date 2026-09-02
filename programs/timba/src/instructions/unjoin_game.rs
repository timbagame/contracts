use crate::error::ErrorCode;
use crate::events::PlayerUnjoined;
use crate::utils::get_clock_snapshot;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let vault_bump = ctx.bumps.game_vault_ctx.game_vault;
    let game = &mut ctx.accounts.game;

    let oracle = &ctx.accounts.oracle;
    let (current_time, current_slot) = get_clock_snapshot()?;
    let player_key = ctx.accounts.player.key();
    let player_index = game
        .participant_index(&player_key)
        .ok_or(ErrorCode::ParticipantNotFound)?;

    // Entries are committed until timeout. A failed underfilled game unlocks at
    // timeout; a ready game unlocks only after the oracle recovery boundary.
    require!(
        game.can_unjoin(oracle.oracle_buffer_time, current_time),
        ErrorCode::OracleBufferNotExpired
    );

    // No need to check completion explicitly: completed games are closed (see CompleteGame: close = creator)

    // Remove the exact participant (single ticket per player).
    let removal = game.remove_player_at(player_index)?;
    game.last_slot = current_slot;

    // Refund player directly
    ctx.accounts.game_vault_ctx.transfer_from_vault(
        &ctx.accounts.player_token_account,
        game.ticket_amount,
        vault_bump,
    )?;

    emit!(PlayerUnjoined::new(
        game,
        player_key,
        removal.removed_index,
        removal.moved_participant,
        current_slot,
        current_time,
    ));

    Ok(())
}
