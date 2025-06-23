use crate::{events::GameInitialized, state::GameType, GameConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeGame>, config: GameConfig) -> Result<()> {
    let game: &mut Account<'_, crate::state::Game> = &mut ctx.accounts.game;
    let clock = Clock::get()?;
    let creator_key = ctx.accounts.creator.key();
    let creator_balance = &mut ctx.accounts.creator_balance;
    let token_mint_key = ctx.accounts.token_mint.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    game.creator = creator_key;
    game.game_type = config.game_type;
    game.max_players = config.max_players;
    game.min_players = config.min_players;
    game.players_count = 0;
    game.token_mint = token_mint_key;
    game.created_at = clock.unix_timestamp as u64;
    game.timeout = config.timeout;
    game.last_slot = clock.slot;
    game.is_private = config.is_private;

    // Set amounts based on game type
    if config.game_type == GameType::Giveaway || config.game_type == GameType::Dumbaway {
        game.total_amount = config.amount;
        game.ticket_amount = 0;
    } else {
        game.total_amount = 0;
        game.ticket_amount = config.amount;
    }

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    // Transfer tokens for giveaway games
    if game.ticket_amount == 0 {
        creator_balance.handle_token_transfer(
            config.amount,
            ctx.accounts.creator_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;
    }

    // ===============================
    // MERKLE SYSTEM INITIALIZATION
    // ===============================

    game.initialize_merkle_system(config.max_players)?;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(GameInitialized {
        game_key: game.key(),
        creator: creator_key,
        game_type: game.game_type,
        ticket_amount: game.ticket_amount,
        total_amount: game.total_amount,
        max_players: game.max_players,
        min_players: game.min_players,
        token_mint: token_mint_key,
        is_private: game.is_private,
        created_at: game.created_at,
        timeout: game.timeout,
    });

    Ok(())
}
