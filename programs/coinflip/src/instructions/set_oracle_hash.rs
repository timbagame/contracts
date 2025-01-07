use crate::state::GameStatus;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::SetOracleHash>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let game_token = &mut ctx.accounts.game_token;
    let player_token = &mut ctx.accounts.player_token;

    // Calculate winner amount and fee amount checking game type
    let total_amount = game.calculate_total_amount();
    let fee_amount = game.calculate_fee_amount(ctx.accounts.oracle.fee_percentage, total_amount);
    let winner_amount = total_amount - fee_amount;
    game_token.fee_amount += fee_amount;
    player_token.amount += winner_amount;

    game.winner = player_token.player;
    game.status = GameStatus::Completed;

    Ok(())
}
