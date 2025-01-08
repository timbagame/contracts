use crate::state::GameType;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Remove player
    if let Some(pos) = game
        .players
        .iter()
        .position(|x| *x == ctx.accounts.player_balance.key())
    {
        game.players.remove(pos);
    }

    // Return funds minus fee if it's a coinflip game
    if game.game_type == GameType::Coinflip {
        let game_token = &mut ctx.accounts.game_token;
        let player_balance = &mut ctx.accounts.player_balance;
        let fee_percentage = ctx.accounts.oracle.fee_percentage;
        let (return_amount, fee_amount) = game.calculate_amounts(1, fee_percentage);
        game_token.fee_amount += fee_amount;
        player_balance.amount += return_amount;
    }

    Ok(())
}
