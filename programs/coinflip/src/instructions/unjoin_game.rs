use crate::{
    error::ErrorCode::GameWaitingForOracle, error::ErrorCode::OnlyLastPlayerCanUnjoin,
    events::PlayerUnjoined, state::GameType,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let oracle = &ctx.accounts.oracle;
    let player_participation = &ctx.accounts.player_participation;
    let clock = Clock::get()?;

    // Check that game is within cancellation window
    if !game.is_within_cancellation_window(
        oracle.oracle_buffer_time as u64,
        clock.unix_timestamp as u64,
    ) {
        return Err(GameWaitingForOracle.into());
    }

    // If it is a Snowball game, only allow if there is only one player
    if game.game_type == GameType::Snowball && game.players_count > 1 {
        return Err(GameWaitingForOracle.into());
    }

    // CRITICAL FIX: Only allow the last player to unjoin to prevent index gaps
    // This ensures winner calculation always works correctly
    if player_participation.player_index != (game.players_count - 1) {
        return Err(OnlyLastPlayerCanUnjoin.into());
    }

    // Return full funds without charging any fee when unjoining
    if game.game_type != GameType::Giveaway {
        let player_balance = &mut ctx.accounts.player_balance;
        player_balance.refund(game.ticket_amount);
        game.total_amount -= game.ticket_amount;
    }

    // Decrement player count and increment slot entropy
    game.players_count -= 1;
    game.slot_entropy += clock.slot;

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: player_participation.player_index,
        slot_entropy: game.slot_entropy,
        timestamp: clock.unix_timestamp as u64,
    });

    Ok(())
}
