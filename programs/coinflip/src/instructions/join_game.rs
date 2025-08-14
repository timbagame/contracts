use crate::error::ErrorCode;
use crate::events::PlayerJoined;
use crate::utils::{get_current_time, get_current_slot};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;
    let player_key = ctx.accounts.player.key();
    let game_key = game.key();

    // ===============================
    // VALIDATION
    // ===============================

    require!(!game.is_expired(current_time), ErrorCode::GameExpired);

    // Basic duplicate participation check handled at application layer now (PlayerGames removed)

    // ===============================
    // STATE UPDATES
    // ===============================

    // Add player to game and update counters
    game.add_player_to_game()?;
    game.last_slot = get_current_slot()?;

    // PlayerGames removed: no per-player bloom tracking; rely on game state only

    // SAFETY: Also add player to the Game's participants filter for redundancy
    game.add_participant_to_filter(&player_key);

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if game.ticket_amount > 0 {
        ctx.accounts.game_token.handle_token_transfer(
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            game.ticket_amount,
            false,
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
