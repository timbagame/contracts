use crate::{
    error::ErrorCode::GameExpired, events::PlayerRolled, state::GameType,
    utils::handle_player_token_transfer,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RollGame>) -> Result<()> {
    // ===============================
    // CHECKS
    // ===============================
    let game = &ctx.accounts.game;
    let clock = Clock::get()?;

    // Block roll if game is expired
    if game.is_expired(clock.unix_timestamp as u64) {
        return Err(GameExpired.into());
    }

    // ===============================
    // EFFECTS - Update all state first
    // ===============================
    let game = &mut ctx.accounts.game;
    let player_participation = &mut ctx.accounts.player_participation;

    // For Snowball games, update amounts
    if game.game_type == GameType::Snowball {
        game.total_amount += game.ticket_amount;
        player_participation.player_amount += game.ticket_amount;
    }

    // Update last slot for entropy
    game.last_slot = clock.slot;

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Transfer tokens if it's a Snowball game (always collect ticket amount)
    if game.game_type == GameType::Snowball {
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
    emit!(PlayerRolled {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        player_index: player_participation.player_index,
        last_slot: game.last_slot,
        timestamp: clock.unix_timestamp as u64,
    });

    Ok(())
}
