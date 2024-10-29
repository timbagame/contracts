use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::{Game, GameType};
use crate::MAX_PARTICIPANTS;

pub fn handler(
    ctx: Context<super::InitializeGame>,
    game_type: GameType,
    amount: u64,
    max_participants: u8,
    timeout_duration: i64,
    is_private: bool,
) -> Result<()> {
    require!(
        ctx.accounts.token_mint.key() == ctx.accounts.config.game_token,
        ErrorCode::InvalidToken
    );
    require!(
        max_participants <= MAX_PARTICIPANTS,
        ErrorCode::InvalidParticipantCount
    );

    match game_type {
        GameType::Coinflip => {
            require!(max_participants >= 2, ErrorCode::InvalidParticipantCount)
        }
        GameType::Giveaway => {
            require!(max_participants >= 1, ErrorCode::InvalidParticipantCount)
        }
    }

    let game = &mut ctx.accounts.game;
    let mut new_game = Game {
        creator: ctx.accounts.creator.key(),
        game_type,
        amount,
        max_participants,
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

    **game = new_game;

    // Transfer tokens to vault
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

    Ok(())
}
