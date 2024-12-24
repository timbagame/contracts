use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::{Game, GameType};

pub fn handler(
    ctx: Context<super::InitializeGame>,
    creator_telegram_id: Option<String>,
    telegram_group_id: Option<String>,
    game_type: GameType,
    amount: u64,
    max_players: u16,
    min_players: u16,
    timeout: i64,
    is_private: bool,
) -> Result<()> {
    let mut new_game = Game {
        id: ctx.accounts.oracle.game_counter,
        creator: ctx.accounts.creator.key(),
        creator_telegram_id,
        telegram_group_id,
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
        ..Default::default()
    };

    if game_type == GameType::Coinflip {
        new_game.add_player(ctx.accounts.creator.key());
    }

    *ctx.accounts.game = new_game;

    // Transfer initial amount
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.creator_token_account.to_account_info(),
                to: ctx.accounts.oracle_token_account.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        amount,
    )?;

    // Increment game counter
    let oracle = &mut ctx.accounts.oracle;
    oracle.game_counter += 1;

    Ok(())
}
