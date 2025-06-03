use crate::{
    events::GameInitialized, state::GameType, utils::handle_player_token_transfer, GameConfig,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeGame>, config: GameConfig) -> Result<()> {
    // Initialize game
    let game = &mut ctx.accounts.game;
    game.creator = ctx.accounts.player.key();
    game.game_type = config.game_type;
    game.amount = config.amount;
    game.max_players = config.max_players;
    game.min_players = config.min_players;
    game.players = Vec::with_capacity(config.max_players as usize);
    game.token_mint = ctx.accounts.game_token.token_mint;
    game.created_at = Clock::get()?.unix_timestamp as u64;
    game.timeout = config.timeout;
    game.is_private = config.is_private;

    if game.game_type == GameType::Coinflip {
        game.players.push(ctx.accounts.player.key());
    }

    // Handle player token transfer using helper function
    handle_player_token_transfer(
        &mut ctx.accounts.player_balance,
        game.amount,
        ctx.accounts.player_token_account.to_account_info(),
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.player.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    )?;

    emit!(GameInitialized {
        game_key: game.key(),
        creator: game.creator,
        game_type: game.game_type,
        amount: game.amount,
        max_players: game.max_players,
        min_players: game.min_players,
        token_mint: game.token_mint,
        timeout: game.timeout,
        is_private: game.is_private,
        created_at: game.created_at,
    });

    Ok(())
}
