use crate::state::{GameStatus, GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::SetOracleNumber>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let game_token = &mut ctx.accounts.game_token;
    let player_balance = &mut ctx.accounts.player_balance;

    // Calculate winner amount and fee amount checking game type
    let players_len = match game.game_type {
        GameType::Coinflip => game.players.len() as u64,
        GameType::Giveaway => 1,
    };
    let fee_percentage = ctx.accounts.oracle.fee_percentage;
    let (winner_amount, fee_amount) = game.calculate_amounts(players_len, fee_percentage);

    game.winner = player_balance.player;
    game.status = GameStatus::Completed;
    game_token.fee_amount += fee_amount;
    player_balance.amount += winner_amount;

    Ok(())
}
