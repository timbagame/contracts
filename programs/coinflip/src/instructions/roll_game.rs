use crate::events::PlayerRolled;
use crate::state::{Game, GameType, SubtreeProof};
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::RollGame>,
    new_merkle_root: [u8; 32],
    unchanged_subtrees: Vec<SubtreeProof>,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let player_key = ctx.accounts.player.key();
    let player_balance = &mut ctx.accounts.player_balance;

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        !game.is_expired(current_time),
        crate::error::ErrorCode::GameExpired
    );

    require!(
        game.game_type == GameType::Snowball || game.game_type == GameType::Dumbflip || game.game_type == GameType::Dumbball || game.game_type == GameType::Dumbaway,
        crate::error::ErrorCode::InvalidGameType
    );

    // ===============================
    // MERKLE TREE UPDATE FOR ADDITIONAL ROLL
    // ===============================

    let ticket_amount = game.ticket_amount;

    // TODO: For Snowball games, we need to add a new entry to the merkle tree
    // representing this additional roll. The client must provide:
    // 1. Updated merkle root with new entry
    // 2. Unchanged subtree proofs for verification

    // For now, simplified implementation
    if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        // Create a new participation entry for this additional roll
        let new_entry_count = 1; // TODO: Get actual entry count from existing participation
        let participation = Game::create_participation_entry(
            player_key,
            ticket_amount,
            game.players_count, // TODO: This should be the next available index
            current_time,
            new_entry_count,
        );

        // Add to merkle tree (this updates the root and validates the change)
        game.add_player_to_merkle_tree(&participation, new_merkle_root, &unchanged_subtrees)?;

        game.last_slot = clock.slot;
    } else {
        // For Dumbflip and Dumbaway, no state changes needed - just emit event
        game.last_slot = clock.slot;
    }

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        player_balance.handle_token_transfer(
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
        player_index: game.players_count - 1, // TODO: Get actual player index from merkle tree
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
