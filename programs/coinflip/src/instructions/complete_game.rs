use crate::{events::GameCompleted, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CompleteGame>) -> Result<()> {
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

    game_token.fee_amount += fee_amount;
    player_balance.amount += winner_amount;

    // Emit event before the account is closed
    emit!(GameCompleted {
        game_key: game.key(),
        creator: game.creator,
        winner: ctx.accounts.player.key(),
        game_type: game.game_type,
        amount: game.amount,
        players_count: game.players.len() as u8,
        token_mint: game.token_mint,
        winner_amount,
        fee_amount,
    });

    Ok(())
}
