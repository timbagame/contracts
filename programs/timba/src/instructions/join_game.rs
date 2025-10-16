use crate::error::ErrorCode;
use crate::events::PlayerJoined;
use crate::utils::{get_clock, participant_hash};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = get_clock()?;
    let current_time = clock.unix_timestamp as u64;
    let current_slot = clock.slot;
    let player_key = ctx.accounts.player.key();
    let token_decimals = ctx.accounts.token_mint.decimals;

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

    ctx.accounts.game_token.handle_token_transfer(
        ctx.accounts.player_token_account.to_account_info(),
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.player.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        game.ticket_amount,
        token_decimals,
        false,
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
