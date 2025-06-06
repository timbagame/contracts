use crate::{error::ErrorCode::GameWaitingForOracle, events::GameCancelled, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &ctx.accounts.game;
    let creator_balance = &mut ctx.accounts.creator_balance;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // Check that game is within cancellation window
    if !game
        .is_within_cancellation_window(ctx.accounts.oracle.oracle_buffer_time as u64, current_time)
    {
        return Err(GameWaitingForOracle.into());
    }

    // Refund creator for giveaway games
    if game.game_type == GameType::Giveaway {
        creator_balance.refund(game.ticket_amount);
    }

    emit!(GameCancelled {
        game_key: game.key(),
        creator: game.creator,
        game_type: game.game_type,
        ticket_amount: game.ticket_amount,
        total_amount: game.total_amount,
        token_mint: game.token_mint,
        timestamp: current_time,
    });

    Ok(())
}
