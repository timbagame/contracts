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
    }

    // Return full funds without charging any fee when unjoining
    if game.game_type == GameType::Coinflip {
        let player_balance = &mut ctx.accounts.player_balance;
        player_balance.amount += game.amount;
    }

    Ok(())
}
