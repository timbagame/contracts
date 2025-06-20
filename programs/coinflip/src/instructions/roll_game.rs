use crate::events::PlayerRolled;
use crate::state::GameType;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RollGame>) -> Result<()> {
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
        game.game_type == GameType::Snowball
            || game.game_type == GameType::Dumbflip
            || game.game_type == GameType::Dumbball
            || game.game_type == GameType::Dumbaway,
        crate::error::ErrorCode::InvalidGameType
    );

    // ===============================
    // MERKLE TREE UPDATE FOR ADDITIONAL ROLL
    // ===============================

    let ticket_amount = game.ticket_amount;

    // TODO: For Snowball/Dumbball games, we need to add a new entry to the merkle tree
    // representing this additional roll. The client must provide:
    // 1. Updated merkle root with new entry
    // 2. Unchanged subtree proofs for verification
    // 3. Current player's participation data to determine next entry index

    // FIXME: Simplified implementation - needs proper merkle tree handling for multiple rolls
    if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        // Create a new participation entry for this additional roll
        // Add to merkle tree (it will create the participation entry internally)
        game.add_player_to_merkle_tree(player_key, current_time)?;

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
        player_index: (game.total_amount / game.ticket_amount) as u32 - 1, // Entry index for this roll
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
