use crate::events::PlayerUnjoined;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let player_key = ctx.accounts.player.key();

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        !game.waiting_for_oracle(oracle.oracle_buffer_time as u64, current_time),
        crate::error::ErrorCode::GameWaitingForOracle
    );

    require!(
        game.players_count > 0,
        crate::error::ErrorCode::InvalidLastPlayerIndex
    );

    require!(
        game.recent_count > 0,
        crate::error::ErrorCode::InvalidLastPlayerIndex
    );

    // ===============================
    // RECENT PLAYER VERIFICATION
    // ===============================

    // Only allow the last player to unjoin to avoid index reordering complexity
    // This ensures the merkle tree structure remains valid
    let last_player_index = game.players_count - 1;
    let test_participation = game.create_participation_entry(player_key, last_player_index);
    let test_hash = game.hash_participation_entry(&test_participation);
    
    // The last player should be the last entry in recent_players
    let last_recent_index = (game.recent_count - 1) as usize;
    
    require!(
        last_recent_index < game.recent_players.len(),
        crate::error::ErrorCode::InvalidLastPlayerIndex
    );
    
    require!(
        game.recent_players[last_recent_index].hash == test_hash,
        crate::error::ErrorCode::UnauthorizedPlayer
    );

    // ===============================
    // STATE UPDATES  
    // ===============================

    let refund_amount = game.ticket_amount;

    // Remove the last player from recent_players (pop the last entry)
    game.recent_players.remove(last_recent_index);
    game.recent_count -= 1;

    // Process refund if there's a ticket amount
    if refund_amount > 0 {
        player_balance.refund(refund_amount);
        game.total_amount = game.total_amount.saturating_sub(refund_amount);
    }

    // Update game state
    game.players_count = game.players_count.saturating_sub(1);
    game.last_slot = clock.slot;

    // Note: No need to update merkle_root since recent players aren't in the root yet
    // The merkle_root only includes committed subtrees, not recent players

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: last_player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
