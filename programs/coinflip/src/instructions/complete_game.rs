use crate::{error::ErrorCode::GameNotReadyForOracle, events::GameCompleted};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CompleteGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let game_token = &mut ctx.accounts.game_token;
    let winner_balance = &mut ctx.accounts.winner_balance;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // Block completion if game is not ready for oracle
    if !game.ready_for_oracle(current_time) {
        return Err(GameNotReadyForOracle.into());
    }

    // Calculate winner amount and fee amount checking game type
    let fee_percentage = ctx.accounts.oracle.fee_percentage as u64;
    let (winner_amount, fee_amount) = game.calculate_amounts(fee_percentage);

    game_token.fee_amount += fee_amount;
    winner_balance.amount += winner_amount;

    emit!(GameCompleted {
        game_key: game.key(),
        winner: ctx.accounts.winner.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        winner_amount,
        fee_amount,
        timestamp: current_time,
    });

    Ok(())
}
