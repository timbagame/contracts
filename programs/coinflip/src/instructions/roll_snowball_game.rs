use crate::{
    error::ErrorCode::GameWaitingForOracle, events::PlayerJoined,
    utils::handle_player_token_transfer,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RollSnowballGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;

    // Check that game is not ready for oracle
    if game.ready_for_oracle(clock.unix_timestamp as u64) {
        return Err(GameWaitingForOracle.into());
    }

    // Always collect the full amount
    handle_player_token_transfer(
        &mut ctx.accounts.player_balance,
        game.amount,
        ctx.accounts.player_token_account.to_account_info(),
        ctx.accounts.game_token_account.to_account_info(),
        ctx.accounts.player.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    )?;

    // Always add to the total pot
    game.total_pot += game.amount;

    // Update last slot to change entropy for winner calculation
    game.last_slot = clock.slot;

    emit!(PlayerJoined {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        game_type: game.game_type,
        amount: game.amount,
        total_pot: game.total_pot,
        current_players: game.player_count,
    });

    Ok(())
}
