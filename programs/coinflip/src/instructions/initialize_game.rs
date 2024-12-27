use anchor_lang::prelude::*;

use crate::state::{Game, GameType};

pub fn handler(
    ctx: Context<super::InitializeGame>,
    game_type: GameType,
    amount: u64,
    max_players: u16,
    min_players: u16,
    timeout: i64,
    is_private: bool,
) -> Result<()> {
    let mut new_game = Game {
        id: ctx.accounts.oracle.games_counter,
        creator: ctx.accounts.creator.key(),
        game_type,
        amount,
        max_players,
        min_players,
        players: Vec::with_capacity(max_players as usize),
        status: crate::state::GameStatus::Active,
        token_mint: ctx.accounts.token_mint.key(),
        created_at: Clock::get()?.unix_timestamp,
        timeout,
        is_private,
        winner: Pubkey::default(),
        ..Default::default()
    };

    if game_type == GameType::Coinflip {
        new_game.players.push(ctx.accounts.creator.key());
    }

    *ctx.accounts.game = new_game;

    // Increment game counter
    let oracle = &mut ctx.accounts.oracle;
    oracle.games_counter += 1;

    Ok(())
}
