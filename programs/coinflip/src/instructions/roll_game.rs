use crate::{events::PlayerRolled, state::GameType, utils::handle_player_token_transfer};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RollGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_participation = &mut ctx.accounts.player_participation;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        !game.is_expired(current_time),
        crate::error::ErrorCode::GameExpired
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    let is_snowball = game.game_type == GameType::Snowball;
    let ticket_amount = game.ticket_amount;

    // For Snowball games, update amounts
    if is_snowball {
        game.total_amount += ticket_amount;
        player_participation.player_amount += ticket_amount;
    }

    game.last_slot = clock.slot;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if is_snowball {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            ticket_amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;
    }

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerRolled {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        player_index: player_participation.player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
