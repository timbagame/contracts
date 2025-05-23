use anchor_lang::prelude::*;

use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Remove player
    if game.game_type == GameType::Coinflip {
        if let Some(pos) = game
            .players
            .iter()
            .position(|x| *x == ctx.accounts.player.key())
        {
            game.players.remove(pos);
        }
    }

    // Cancel game if it's a giveaway or if there are no players left
    if game.game_type == GameType::Giveaway || game.players.is_empty() {
        game.status = GameStatus::Cancelled;
    }

    // Return full funds without charging any fee when cancelling
    let player_balance = &mut ctx.accounts.player_balance;
    player_balance.amount += game.amount;

    Ok(())
}
