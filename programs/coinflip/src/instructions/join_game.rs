use crate::error::ErrorCode;
use crate::events::PlayerJoined;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let player_key = ctx.accounts.player.key();
    let game_key = game.key();

    // ===============================
    // VALIDATION
    // ===============================

    require!(!game.is_expired(current_time), ErrorCode::GameExpired);

    // Check for double join using player balance bloom filter
    require!(
        player_balance.can_join_game(&game_key, game.created_at),
        ErrorCode::AlreadyJoined
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    // Add player to game and update counters
    game.add_player_to_game()?;
    game.last_slot = clock.slot;

    // Mark game as joined in player's bloom filter
    let game_expiry = game.calculate_expiry_timestamp(oracle.oracle_buffer_time);
    player_balance.mark_game_joined(&game_key, game_expiry, current_time);

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
