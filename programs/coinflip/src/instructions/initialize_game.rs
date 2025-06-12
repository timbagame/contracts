use crate::{
    events::GameInitialized, state::GameType, utils::handle_player_token_transfer, GameConfig,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeGame>, config: GameConfig) -> Result<()> {
    // ===============================
    // EFFECTS - Update all state first
    // ===============================
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;

    // Initialize game state
    game.creator = ctx.accounts.creator.key();
    game.game_type = config.game_type;
    game.max_players = config.max_players;
    game.min_players = config.min_players;
    game.players_count = 0;
    game.token_mint = ctx.accounts.token_mint.key();
    game.created_at = clock.unix_timestamp as u64;
    game.timeout = config.timeout;
    game.last_slot = clock.slot;
    game.is_private = config.is_private;
    game.last_player = Pubkey::default();

    // Set amounts based on game type
    if config.game_type == GameType::Giveaway {
        game.total_amount = config.amount;
        game.ticket_amount = 0;
    } else {
        game.total_amount = 0;
        game.ticket_amount = config.amount;
    }

    // ===============================
    // INTERACTIONS - External calls
    // ===============================

    // Transfer tokens for giveaway games
    if game.ticket_amount == 0 {
        handle_player_token_transfer(
            &mut ctx.accounts.creator_balance,
            config.amount,
            ctx.accounts.creator_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;
    }

    // Emit event
    emit!(GameInitialized {
        game_key: game.key(),
        creator: game.creator,
        game_type: game.game_type,
        ticket_amount: game.ticket_amount,
        total_amount: game.total_amount,
        max_players: game.max_players,
        min_players: game.min_players,
        token_mint: game.token_mint,
        is_private: game.is_private,
        created_at: game.created_at,
        timeout: game.timeout,
    });

    Ok(())
}
