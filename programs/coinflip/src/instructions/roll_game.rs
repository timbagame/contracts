use crate::error::ErrorCode;
use crate::events::PlayerRolled;
use crate::state::GameType;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RollGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let _player_key = ctx.accounts.player.key();
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

    // Verify player has already joined this game using player balance bloom filter
    require!(
        !player_balance.can_join_game(&game.key(), game.created_at),
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
    // BLOOM FILTER UPDATE FOR ADDITIONAL ROLL
    // ===============================

    let ticket_amount = game.ticket_amount;
    let entry_index = if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        // For accumulating games, each roll creates an additional participation entry
        game.add_player_to_game()?;
        let new_index = game.tickets_count - 1;
        
        // Mark this specific game + index combination in player's filter
        let game_expiry = game.calculate_expiry_timestamp(oracle.get_total_buffer_time());
        player_balance.mark_game_index_joined(&game.key(), new_index, game_expiry, current_time);
        
        new_index // New ticket just added
    } else {
        // For Dumbflip and Dumbaway, return the player's current ticket index
        // These games don't accumulate additional tickets
        game.tickets_count - 1 // Player's existing ticket index
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
