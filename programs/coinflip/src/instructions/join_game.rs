use crate::{
    error::ErrorCode::GameWaitingForOracle, events::PlayerJoined, state::GameType,
    utils::handle_player_token_transfer,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_participation = &mut ctx.accounts.player_participation;
    let clock = Clock::get()?;

    // Check that game is not ready for oracle
    if game.ready_for_oracle(clock.unix_timestamp as u64) {
        return Err(GameWaitingForOracle.into());
    }

    // If it is not a giveaway, the player must pay the amount
    if game.game_type != GameType::Giveaway {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            game.amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;

        game.total_pot += game.amount;
    }

    // Set player index for winner calculation
    player_participation.player_index = game.player_count;

    // Increment player count and update last slot
    game.player_count += 1;
    game.last_slot = clock.slot;

    emit!(PlayerJoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        game_type: game.game_type,
        amount: game.amount,
        total_pot: game.total_pot,
        current_players: game.player_count,
        last_slot: game.last_slot,
    });

    Ok(())
}
