use crate::state::{handle_player_token_transfer, GameType};
use anchor_lang::prelude::*;

#[event]
pub struct PlayerJoined {
    pub game_key: Pubkey,
    pub player: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub current_players: u8,
    pub max_players: u8,
}

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Check player token amount
    if game.game_type == GameType::Coinflip {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            game.amount,
            &ctx.accounts.player_token_account.to_account_info(),
            &ctx.accounts.game_token_account.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
        )?;
    }

    game.players.push(ctx.accounts.player.key());

    emit!(PlayerJoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        game_type: game.game_type,
        amount: game.amount,
        current_players: game.players.len() as u8,
        max_players: game.max_players,
    });

    Ok(())
}
