use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::{Game, GameType};

pub fn handler(
    ctx: Context<super::InitializeGame>,
    game_type: GameType,
    amount: u64,
    max_participants: u16,
    min_participants: u16,
    timeout_duration: i64,
    is_private: bool,
) -> Result<()> {
    let mut new_game = Game {
        creator: ctx.accounts.creator.key(),
        game_type,
        amount,
        max_participants,
        min_participants,
        participants: Vec::with_capacity(max_participants as usize),
        status: crate::state::GameStatus::Active,
        token_mint: ctx.accounts.token_mint.key(),
        created_at: Clock::get()?.unix_timestamp,
        timeout_duration,
        is_private,
        ..Default::default()
    };

    if game_type == GameType::Coinflip {
        new_game.add_participant(ctx.accounts.creator.key());
    }

    *ctx.accounts.game = new_game;

    // Transfer initial amount
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.creator_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        amount,
    )?;

    // Increment game counter
    let config = &mut ctx.accounts.config;
    config.game_counter = config.game_counter.checked_add(1).unwrap();

    Ok(())
}
