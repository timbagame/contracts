use anchor_lang::prelude::*;

use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Remove player
    if game.game_type == GameType::Coinflip {
        if let Some(pos) = game
            .players
            .iter()
            .position(|x| *x == ctx.accounts.player_balance.key())
        {
            game.players.remove(pos);
        }
    }

    // Cancel game if it's a giveaway or if there are no players left
    if game.game_type == GameType::Giveaway || game.players.is_empty() {
        game.status = GameStatus::Cancelled;
    }

    // Return funds minus fee
    let game_token = &mut ctx.accounts.game_token;
    let player_balance = &mut ctx.accounts.player_balance;
    let (return_amount, fee_amount) = game.calculate_amounts(1, ctx.accounts.oracle.fee_percentage);
    game_token.fee_amount += fee_amount;
    player_balance.amount += return_amount;

    Ok(())
}
