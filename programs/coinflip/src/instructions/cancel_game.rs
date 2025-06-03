use crate::{events::GameCancelled, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;

    // Handle refunds based on game type
    match game.game_type {
        GameType::Giveaway => {
            // For giveaway games, always refund to creator (creator puts up the prize)
            if ctx.accounts.creator.key() == game.creator {
                player_balance.refund(game.amount);
            }
        }
        GameType::Coinflip => {
            // For coinflip games, refund if player has stake in the game
            if game.players.contains(&ctx.accounts.creator.key()) {
                player_balance.refund(game.amount);
            }
        }
    }

    emit!(GameCancelled {
        game_key: game.key(),
        creator: game.creator,
        game_type: game.game_type,
        amount: game.amount,
        token_mint: game.token_mint,
    });

    Ok(())
}
