use crate::{error::ErrorCode::GameWaitingForOracle, events::PlayerUnjoined, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;

    // Check that game is within cancellation window
    if !game.is_within_cancellation_window(
        oracle.oracle_buffer_time as u64,
        clock.unix_timestamp as u64,
    ) {
        return Err(GameWaitingForOracle.into());
    }

    // Return full funds without charging any fee when unjoining
    if game.game_type == GameType::Coinflip {
        let player_balance = &mut ctx.accounts.player_balance;
        player_balance.refund(game.amount);
    }

    // Decrement player count and update last slot
    game.player_count -= 1;
    game.last_slot = clock.slot;

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        game_type: game.game_type,
        amount: game.amount,
        current_players: game.player_count,
    });

    Ok(())
}
