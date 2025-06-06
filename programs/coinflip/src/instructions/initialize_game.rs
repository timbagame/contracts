use crate::{
    events::GameInitialized, state::GameType, utils::handle_player_token_transfer, GameConfig,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeGame>, config: GameConfig) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;

    game.creator = ctx.accounts.player.key();
    game.game_type = config.game_type;
    game.max_players = config.max_players;
    game.min_players = config.min_players;
    game.player_count = 0;
    game.token_mint = ctx.accounts.token_mint.key();
    game.expires_at = clock.unix_timestamp as u64 + config.timeout as u64;
    game.last_slot = clock.slot;
    game.is_private = config.is_private;

    // If it is a giveaway, the creator will pay the pot
    if game.game_type == GameType::Giveaway {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            config.amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;

        game.total_pot = config.amount;
        game.amount = 0;
    } else {
        game.total_pot = 0;
        game.amount = config.amount;
    }

    emit!(GameInitialized {
        game_key: game.key(),
        creator: game.creator,
        game_type: game.game_type,
        amount: game.amount,
        max_players: game.max_players,
        min_players: game.min_players,
        token_mint: game.token_mint,
        is_private: game.is_private,
        expires_at: game.expires_at,
    });

    Ok(())
}
