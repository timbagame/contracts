use crate::{
    error::ErrorCode::GameExpired, events::PlayerJoined, state::GameType,
    utils::handle_player_token_transfer,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_participation = &mut ctx.accounts.player_participation;
    let clock = Clock::get()?;

    // Block join if game is expired
    if game.is_expired(clock.unix_timestamp as u64) {
        return Err(GameExpired.into());
    }

    // If it is not a giveaway, the player must pay the amount
    if game.game_type != GameType::Giveaway {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            game.ticket_amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;

        game.total_amount += game.ticket_amount;
        player_participation.player_amount = game.ticket_amount;
    }

    // Set player index for winner calculation and slot when the player joined the game
    player_participation.player_index = game.players_count;
    player_participation.joined_at = clock.slot;

    // Increment players count
    game.players_count += 1;

    // Ensure we're not reusing the same slot
    if clock.slot == game.last_slot {
        return Err(crate::error::ErrorCode::SameSlotReuse.into());
    }
    game.last_slot = clock.slot;

    emit!(PlayerJoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: player_participation.player_index,
        last_slot: game.last_slot,
        timestamp: clock.unix_timestamp as u64,
    });

    Ok(())
}
