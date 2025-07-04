use crate::error::ErrorCode;
use crate::events::PlayerRolled;
use crate::state::{GameType, Game, ParticipationEntry};
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::RollGame>,
    player_participation: ParticipationEntry,
    player_merkle_proof: Vec<[u8; 32]>,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let player_key = ctx.accounts.player.key();
    let player_balance = &mut ctx.accounts.player_balance;

    // ===============================
    // VALIDATION
    // ===============================

    require!(!game.is_expired(current_time), ErrorCode::GameExpired);

    require!(
        game.game_type == GameType::Snowball
            || game.game_type == GameType::Dumbflip
            || game.game_type == GameType::Dumbball
            || game.game_type == GameType::Dumbaway,
        ErrorCode::InvalidGameType
    );

    // Verify player participation proof
    let player_leaf = Game::hash_participation_entry(&player_participation);
    require!(
        game.verify_player_participation(
            player_leaf,
            &player_merkle_proof,
            player_participation.ticket_index,
        ),
        ErrorCode::InvalidMerkleProof
    );

    // Verify the player matches the account
    require!(
        player_participation.player == player_key,
        ErrorCode::UnauthorizedPlayer
    );

    // For games that add entries, check balance requirement
    if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        require!(
            game.has_sufficient_balance_for_join(
                ctx.accounts.player_token_account.amount,
                player_balance.amount
            ),
            ErrorCode::InsufficientBalance
        );
    }

    // ===============================
    // MERKLE TREE UPDATE FOR ADDITIONAL ROLL
    // ===============================

    let ticket_amount = game.ticket_amount;
    let entry_index = if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        // For accumulating games, each roll creates an additional participation entry
        // The same player can have multiple tickets in the merkle tree
        game.add_ticket_to_merkle_tree(player_key)?;
        game.tickets_count - 1 // New ticket just added
    } else {
        // For Dumbflip and Dumbaway, return the player's original ticket index
        // These games don't accumulate additional tickets
        player_participation.ticket_index
    };

    game.last_slot = clock.slot;

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
        tickets_count: game.tickets_count,
        ticket_index: entry_index, // Correct ticket index based on game type
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
