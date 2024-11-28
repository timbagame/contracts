use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::{Game, GameType};

pub fn handler(
    ctx: Context<super::InitializeGame>,
    game_type: GameType,
    amount: u64,
    max_participants: u8,
    min_participants: u8,
    timeout_duration: i64,
    is_private: bool,
    is_sol: bool,
) -> Result<()> {
    require!(
        min_participants <= max_participants,
        ErrorCode::InvalidParticipantCount
    );

    match game_type {
        GameType::Coinflip => {
            require!(max_participants >= 2, ErrorCode::InvalidParticipantCount);
            require!(min_participants >= 2, ErrorCode::InvalidParticipantCount);
        }
        GameType::Giveaway => {
            require!(max_participants >= 1, ErrorCode::InvalidParticipantCount);
            require!(min_participants >= 1, ErrorCode::InvalidParticipantCount);
        }
    }

    let mut new_game = Game {
        creator: ctx.accounts.creator.key(),
        game_type,
        amount,
        max_participants,
        min_participants,
        participants: Vec::with_capacity(max_participants as usize),
        status: crate::state::GameStatus::Active,
        token_mint: if is_sol { 
            Pubkey::default() 
        } else {
            ctx.accounts.token_mint.as_ref().unwrap().key()
        },
        created_at: Clock::get()?.unix_timestamp,
        timeout_duration,
        is_private,
        is_sol,
        ..Default::default()
    };

    if game_type == GameType::Coinflip {
        new_game.add_participant(ctx.accounts.creator.key());
    }

    *ctx.accounts.game = new_game;

    // Transfer initial amount
    if is_sol {
        // Transfer SOL to vault
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.vault.as_ref().unwrap().to_account_info(),
                },
            ),
            amount,
        )?;
    } else {
        // Transfer SPL tokens to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.as_ref().unwrap().to_account_info(),
                token::Transfer {
                    from: ctx.accounts.creator_token_account.as_ref().unwrap().to_account_info(),
                    to: ctx.accounts.vault_token_account.as_ref().unwrap().to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            amount,
        )?;
    }

    Ok(())
}
