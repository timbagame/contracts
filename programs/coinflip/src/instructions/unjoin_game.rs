use crate::events::PlayerUnjoined;
use crate::state::Game;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>, merkle_proof: Option<Vec<[u8; 32]>>) -> Result<()> {
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

        // Merkle proof is required for subtree players
        let proof = merkle_proof.ok_or(crate::error::ErrorCode::InvalidAmount)?;

        require!(!proof.is_empty(), crate::error::ErrorCode::InvalidAmount);

        // Verify the player is in the merkle tree with the expected index
        require!(
            game.verify_merkle_proof(player_leaf_hash, &proof, expected_player_index),
            crate::error::ErrorCode::UnauthorizedPlayer
        );

        // No need to update merkle root - we just verify the player was legitimately in the game
        // The security comes from only allowing the current last player (players_count - 1) to unjoin
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
