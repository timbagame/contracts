use crate::error::ErrorCode;
use crate::events::PlayerRefunded;
use crate::utils::get_clock_snapshot;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RefundPlayer>) -> Result<()> {
    let vault_bump = ctx.bumps.game_vault_ctx.game_vault;
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let (current_time, current_slot) = get_clock_snapshot()?;
    let player_key = ctx.accounts.player.key();

    // Entries are committed until timeout. A failed underfilled game unlocks at
    // timeout; a ready game unlocks only after the oracle recovery boundary.
    require!(game.is_expired(current_time), ErrorCode::GameNotExpired);
    require!(
        game.is_unlocked(oracle.oracle_buffer_time, current_time),
        ErrorCode::OracleBufferNotExpired
    );

    // Remove the exact participant (single ticket per player).
    let removal = game.remove_participant(&player_key)?;
    game.last_slot = current_slot;

    // Refund player directly
    ctx.accounts.game_vault_ctx.transfer_from_vault(
        &ctx.accounts.player_token_account,
        game.ticket_amount,
        vault_bump,
    )?;

    emit!(PlayerRefunded::new(
        game,
        player_key,
        removal.removed_index,
        removal.moved_participant,
        current_slot,
        current_time,
    ));

    Ok(())
}
