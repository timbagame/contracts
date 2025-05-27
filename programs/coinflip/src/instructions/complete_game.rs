use crate::state::GameType;
use anchor_lang::prelude::*;

#[event]
pub struct GameCompleted {
    pub game_key: Pubkey,
    pub creator: Pubkey,
    pub winner: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub players: Vec<Pubkey>,
    pub token_mint: Pubkey,
    pub winner_amount: u64,
    pub fee_amount: u64,
}

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

    game.winner = ctx.accounts.player.key();
    game_token.fee_amount += fee_amount;
    player_balance.amount += winner_amount;

    // Emit event before the account is closed
    emit!(GameCompleted {
        game_key: game.key(),
        creator: game.creator,
        winner: game.winner,
        game_type: game.game_type,
        amount: game.amount,
        players: game.players.clone(),
        token_mint: game.token_mint,
        winner_amount,
        fee_amount,
    });

    Ok(())
}
