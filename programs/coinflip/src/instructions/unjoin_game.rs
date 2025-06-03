use crate::{events::PlayerUnjoined, state::GameType};
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
        player_balance.refund(game.amount);
    }

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        game_type: game.game_type,
        amount: game.amount,
        current_players: game.players.len() as u16,
    });

    Ok(())
}
