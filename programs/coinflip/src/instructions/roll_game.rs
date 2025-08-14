use crate::error::ErrorCode;
use crate::events::PlayerRolled;
use crate::state::GameType;
use crate::utils::{get_current_time, get_current_slot};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RollGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let current_time = get_current_time()?;
    let _player_key = ctx.accounts.player.key();


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

    // PlayerGames removed: cannot re-validate prior join beyond participant filter presence
    require!(
        game.check_participant_in_filter(&_player_key),
        ErrorCode::UnauthorizedPlayer
    );

    // For games that add entries, check balance requirement
    if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        require!(
            game.has_sufficient_balance_for_join(ctx.accounts.player_token_account.amount),
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
        
        // Update participants filter redundantly (already set on first join)
        game.add_participant_to_filter(&ctx.accounts.player.key());
        new_index // New ticket just added
    } else {
        // For Dumbflip and Dumbaway, return the player's current ticket index
        // These games don't accumulate additional tickets
        game.tickets_count - 1 // Player's existing ticket index
    };

    game.last_slot = get_current_slot()?;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if game.game_type == GameType::Snowball || game.game_type == GameType::Dumbball {
        ctx.accounts.game_token.handle_token_transfer(
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ticket_amount,
            false,
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
