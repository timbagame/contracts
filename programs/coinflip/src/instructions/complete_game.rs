use crate::{error::ErrorCode::GameNotReadyForOracle, events::GameCompleted};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CompleteGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let game_token = &mut ctx.accounts.game_token;
    let winner_balance = &mut ctx.accounts.winner_balance;
    let current_time = Clock::get()?.unix_timestamp as u64;

    // Check that game is ready for oracle
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
        creator: game.creator,
        winner: ctx.accounts.winner.key(),
        game_type: game.game_type,
        amount: game.amount,
        players_count: game.player_count,
        token_mint: game.token_mint,
        winner_amount,
        fee_amount,
    });

    Ok(())
}
