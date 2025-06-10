use crate::{
    error::ErrorCode::GameExpired, events::PlayerJoined, state::GameType,
    utils::handle_player_token_transfer,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    // ===============================
    // CHECKS
    // ===============================
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    // Block join if game is expired
    if game.is_expired(current_time) {
        return Err(GameExpired.into());
    }

    // ===============================
    // EFFECTS - Update all state first
    // ===============================
    let player_participation = &mut ctx.accounts.player_participation;
    let is_non_giveaway = game.game_type != GameType::Giveaway;

    // Set player index and update counts
    player_participation.player_index = game.players_count;
    game.players_count += 1;
    game.last_slot = clock.slot;

    // Update amounts for non-giveaway games
    if is_non_giveaway {
        player_participation.player_amount = game.ticket_amount;
        game.total_amount += game.ticket_amount;
    }

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Transfer tokens for non-giveaway games
    if is_non_giveaway {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            game.ticket_amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;
    }

    // Emit event
    emit!(PlayerJoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: player_participation.player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
