use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::ClaimWinnings>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    let total_pot = match game.game_type {
        GameType::Coinflip => game.amount * (game.players.len() as u64),
        GameType::Giveaway => game.amount,
    };
    let fee_amount = total_pot * (ctx.accounts.oracle.fee_percentage as u64) / 100;
    let winner_amount = total_pot - fee_amount;

    game.status = GameStatus::Completed;

    // Transfer winnings to winner
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[b"vault", game.token_mint.as_ref(), &[ctx.bumps.vault]]],
        ),
        winner_amount,
    )?;

    // Transfer fees to operator
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.operator_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[b"vault", game.token_mint.as_ref(), &[ctx.bumps.vault]]],
        ),
        fee_amount,
    )?;

    Ok(())
}
