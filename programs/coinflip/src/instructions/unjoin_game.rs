use crate::state::GameType;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Remove player
    if let Some(pos) = game
        .players
        .iter()
        .position(|x| *x == ctx.accounts.player.key())
    {
        game.players.remove(pos);

        // Return funds if it's a coinflip game
        if game.game_type == GameType::Coinflip {
            let player_token = &mut ctx.accounts.player_token;
            player_token.amount += game.amount;
        }
    }

    Ok(())
}
