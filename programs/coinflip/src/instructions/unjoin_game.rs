use crate::events::PlayerUnjoined;
use crate::state::{ExclusionProof, Game};
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::UnjoinGame>,
    player_index: u32,
    exclusion_proof: Option<ExclusionProof>,
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

    require!(
        player_index < game.players_count,
        crate::error::ErrorCode::InvalidLastPlayerIndex
    );

    // ===============================
    // VERIFY PLAYER IDENTITY
    // ===============================

    let participation_entry = Game::create_participation_entry(player_key, player_index);
    let player_leaf_hash = Game::hash_participation_entry(&participation_entry);

    // ===============================
    // DETERMINE UNJOIN STRATEGY BASED ON PLAYER LOCATION
    // ===============================

    // Check if player is in recent_players
    let mut found_in_recent = false;
    let mut recent_player_index = 0;

    for (i, recent_leaf) in game.recent_players.iter().enumerate() {
        if recent_leaf.hash == player_leaf_hash {
            found_in_recent = true;
            recent_player_index = i;
            break;
        }
    }

    if found_in_recent {
        // ===============================
        // CASE 1: PLAYER IN RECENT_PLAYERS
        // ===============================

        let last_recent_index = (game.recent_count - 1) as usize;

        if recent_player_index == last_recent_index {
            // Case 1a: Player is last in recent_players - simple removal
            game.recent_players.remove(recent_player_index);
            game.recent_count -= 1;
        } else {
            // Case 1b: Player is not last in recent_players - swap with last
            game.recent_players
                .swap(recent_player_index, last_recent_index);
            game.recent_players.remove(last_recent_index);
            game.recent_count -= 1;
        }
    } else {
        // ===============================
        // CASE 2: PLAYER IN SUBTREE
        // ===============================

        // Verify the player is actually in a subtree
        require!(
            game.find_subtree_containing_player(player_index).is_some(),
            crate::error::ErrorCode::UnauthorizedPlayer
        );

        // Case 2: Subtree player unjoin - always use swap-with-last approach
        let exclusion_proof = exclusion_proof.ok_or(crate::error::ErrorCode::InvalidAmount)?;

        // Verify the exclusion proof with swap-with-last operation
        require!(
            game.verify_exclusion_proof(&exclusion_proof, player_key, player_index)?,
            crate::error::ErrorCode::InvalidExclusionProof
        );

        // Apply the verified swap-with-last operation
        game.modify_subtree_after_verified_exclusion(&exclusion_proof, player_index)?;
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
        player_index: player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
