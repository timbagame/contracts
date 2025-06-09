use crate::{error::ErrorCode::GameWaitingForOracle, events::GameCancelled, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &ctx.accounts.game;
    let creator_balance = &mut ctx.accounts.creator_balance;
    let oracle = &ctx.accounts.oracle;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // Block cancellation if game is ready for oracle AND buffer time has not passed
    if game.ready_for_oracle(current_time)
        && !game.buffer_passed(oracle.oracle_buffer_time as u64, current_time)
    {
        return Err(GameWaitingForOracle.into());
    }

    // Refund creator for giveaway games
    if game.game_type == GameType::Giveaway {
        creator_balance.refund(game.ticket_amount);
    }

    emit!(GameCancelled {
        game_key: game.key(),
        timestamp: current_time,
    });

    Ok(())
}
