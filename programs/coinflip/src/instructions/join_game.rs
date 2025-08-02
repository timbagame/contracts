use crate::error::ErrorCode;
use crate::events::PlayerJoined;
use crate::utils::{get_current_time, get_current_slot};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;
    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;
    let player_key = ctx.accounts.player.key();
    let game_key = game.key();

    // ===============================
    // VALIDATION
    // ===============================

    require!(!game.is_expired(current_time), ErrorCode::GameExpired);

    // Collision detection with automatic filter switching
    require!(
        player_balance.can_join_game(&game_key, &player_key, &game, &oracle, current_time),
        ErrorCode::AlreadyJoined
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    // Add player to game and update counters
    game.add_player_to_game()?;
    game.last_slot = get_current_slot()?;

    // Mark game as joined in player's bloom filter with collision detection integration
    let game_expiry = game.calculate_expiry_timestamp(oracle.get_total_buffer_time());
    player_balance.mark_game_joined(&game_key, game_expiry, current_time);
    
    // Also mark the specific game+index combination for ticket index 0
    player_balance.mark_game_index_joined(&game_key, game.tickets_count - 1, game_expiry, current_time);

    // SAFETY: Also add player to the Game's participants filter for redundancy
    game.add_participant_to_filter(&player_key);

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if game.ticket_amount > 0 {
        player_balance.handle_token_transfer(
            game.ticket_amount,
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
        tickets_count: game.tickets_count,
        ticket_index: game.tickets_count - 1, // Just joined, so index is tickets_count - 1
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
