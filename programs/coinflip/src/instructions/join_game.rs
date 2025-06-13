use crate::{events::PlayerJoined, utils::handle_player_token_transfer};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_participation = &mut ctx.accounts.player_participation;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let player_key = ctx.accounts.player.key();

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

    let ticket_amount = game.ticket_amount;
    let player_index = game.players_count;

    // Update player participation
    player_participation.player_index = player_index;

    // Update game state
    game.players_count += 1;
    game.last_slot = clock.slot;

    // Update amounts for non-giveaway games
    if ticket_amount > 0 {
        player_participation.player_amount = ticket_amount;
        game.total_amount += ticket_amount;
    }

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if ticket_amount > 0 {
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

    emit!(PlayerJoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
