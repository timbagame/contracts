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
            game.ticket_amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;

        game.total_amount += game.ticket_amount;
    }

    // Set player index for winner calculation
    player_participation.player_index = game.players_count;

    // Increment player count and slot entropy
    game.players_count += 1;
    game.slot_entropy += clock.slot;

    emit!(PlayerJoined {
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
        player_index: player_participation.player_index,
        is_private: game.is_private,
        created_at: game.created_at,
        timeout: game.timeout,
        timestamp: clock.unix_timestamp as u64,
    });

    Ok(())
}
