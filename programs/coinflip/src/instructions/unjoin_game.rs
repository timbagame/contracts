use crate::events::PlayerUnjoined;
use crate::state::{Game, ExclusionProof};
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::UnjoinGame>, 
    exclusion_proof: Option<ExclusionProof>
) -> Result<()> {
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

    // Player must be the last player (highest index) to maintain order
    let expected_player_index = game.players_count - 1;
    let participation_entry = Game::create_participation_entry(player_key, expected_player_index);
    let player_leaf_hash = Game::hash_participation_entry(&participation_entry);

    // ===============================
    // DETERMINE UNJOIN TYPE: RECENT vs SUBTREE
    // ===============================

    if game.recent_count > 0 {
        // ===============================
        // PHASE 1: RECENT PLAYER UNJOIN
        // ===============================

        // Player must be the last recent player
        let last_recent_index = (game.recent_count - 1) as usize;

        require!(
            last_recent_index < game.recent_players.len(),
            crate::error::ErrorCode::InvalidLastPlayerIndex
        );

        require!(
            game.recent_players[last_recent_index].hash == player_leaf_hash,
            crate::error::ErrorCode::UnauthorizedPlayer
        );

        // Remove player from recent_players
        game.recent_players.remove(last_recent_index);
        game.recent_count -= 1;
    } else {
        // ===============================
        // PHASE 2: SUBTREE PLAYER UNJOIN
        // ===============================

        // Exclusion proof is required for subtree players
        let exclusion_proof = exclusion_proof.ok_or(crate::error::ErrorCode::InvalidAmount)?;

        // Verify the exclusion proof cryptographically
        require!(
            game.verify_exclusion_proof(&exclusion_proof, player_key, expected_player_index)?,
            crate::error::ErrorCode::InvalidExclusionProof
        );

        // Apply the verified exclusion to update the subtree
        game.modify_subtree_after_verified_exclusion(&exclusion_proof, expected_player_index)?;
    }

    // ===============================
    // STATE UPDATES (COMMON)
    // ===============================

    let refund_amount = game.ticket_amount;

    // Process refund if there's a ticket amount
    if refund_amount > 0 {
        player_balance.refund(refund_amount);
        game.total_amount = game.total_amount.saturating_sub(refund_amount);
    }

    // Update game state - decrement players_count to allow next player to unjoin
    game.players_count = game.players_count.saturating_sub(1);
    game.last_slot = clock.slot;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: expected_player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
