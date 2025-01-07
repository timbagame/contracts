use crate::state::GameStatus;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::SetOracleHash>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let game_token = &mut ctx.accounts.game_token;
    let player_token = &mut ctx.accounts.player_token;

    // Calculate winner amount and fee amount checking game type
    let (winner_amount, fee_amount) = game.calculate_amounts(ctx.accounts.oracle.fee_percentage);

    game.winner = player_token.player;
    game.status = GameStatus::Completed;
    game_token.fee_amount += fee_amount;
    player_token.amount += winner_amount;

    Ok(())
}
