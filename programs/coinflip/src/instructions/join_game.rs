use crate::{events::PlayerJoined, utils::handle_player_token_transfer, state::{SubtreeProof, ParticipationEntry}};
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::JoinGame>,
    new_merkle_root: [u8; 32],
    unchanged_subtrees: Vec<SubtreeProof>,
    participation_entry: ParticipationEntry,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
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
    // MERKLE TREE UPDATE
    // ===============================

    // Validate the participation entry provided by client
    require!(
        participation_entry.player == player_key,
        crate::error::ErrorCode::UnauthorizedPlayer
    );
    require!(
        participation_entry.player_index == game.players_count,
        crate::error::ErrorCode::InvalidPlayersCount
    );
    require!(
        participation_entry.amount == game.ticket_amount,
        crate::error::ErrorCode::InvalidAmount
    );
    require!(
        participation_entry.entry_count == 1, // Regular join always has 1 entry
        crate::error::ErrorCode::InvalidAmount
    );

    // Add player to merkle tree (this verifies the update is valid)
    game.add_player_to_merkle_tree(&participation_entry, new_merkle_root, &unchanged_subtrees)?;

    // Update game state
    game.last_slot = clock.slot;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if participation_entry.amount > 0 {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            participation_entry.amount,
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
        player_index: participation_entry.player_index,
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
