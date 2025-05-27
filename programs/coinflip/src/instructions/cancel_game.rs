use crate::state::GameType;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Return full funds without charging any fee when cancelling
    let player_balance = &mut ctx.accounts.player_balance;

    match game.game_type {
        GameType::Giveaway => {
            // For giveaway games, always return to creator (creator puts up the prize)
            // Players don't stake anything in giveaways
            player_balance.amount += game.amount;
        }
        GameType::Coinflip => {
            // For coinflip games, only return if exactly 1 player who is the creator
            // If empty, funds were already returned when players unjoined
            if game.players.len() == 1 && game.players[0] == game.creator {
                player_balance.amount += game.amount;
            }
        }
    }

    Ok(())
}
