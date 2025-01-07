use anchor_lang::prelude::*;

use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    if game.status == GameStatus::Active {
        game.status = GameStatus::Cancelled;
    }

    // Only return funds for giveaway games
    if game.game_type == GameType::Giveaway {
        let player_token = &mut ctx.accounts.player_token;
        player_token.amount += game.amount;
    }

    Ok(())
}
