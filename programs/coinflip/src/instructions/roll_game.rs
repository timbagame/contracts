use crate::{
    error::ErrorCode::GameWaitingForOracle, events::PlayerRolled, state::GameType,
    utils::handle_player_token_transfer,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::RollGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;

    // Check that game is not ready for oracle
    if game.ready_for_oracle(clock.unix_timestamp as u64) {
        return Err(GameWaitingForOracle.into());
    }

    // If it is a Snowball game, always collect the ticket amount
    if game.game_type == GameType::Snowball {
        handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            game.ticket_amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;

        game.total_amount += game.ticket_amount;
    }

    // Increment slot entropy for winner calculation
    game.slot_entropy += clock.slot;

    emit!(PlayerRolled {
        game_key: game.key(),
        creator: game.creator,
        player: ctx.accounts.player.key(),
        game_type: game.game_type,
        token_mint: game.token_mint,
        max_players: game.max_players,
        min_players: game.min_players,
        ticket_amount: game.ticket_amount,
        total_amount: game.total_amount,
        players_count: game.players_count,
        slot_entropy: game.slot_entropy,
        player_index: ctx.accounts.player_participation.player_index,
        is_private: game.is_private,
        created_at: game.created_at,
        timeout: game.timeout,
        timestamp: clock.unix_timestamp as u64,
    });

    Ok(())
}
