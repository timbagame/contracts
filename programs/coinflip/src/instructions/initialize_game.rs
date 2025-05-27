use crate::{state::GameType, GameConfig};
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
    crate::state::handle_player_token_transfer(
        &mut ctx.accounts.player_balance,
        game.amount,
        &ctx.accounts.player_token_account.to_account_info(),
        &ctx.accounts.game_token_account.to_account_info(),
        &ctx.accounts.player.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
    )?;

    Ok(())
}
