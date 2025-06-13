use crate::events::PlayerParticipationCleaned;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CleanPlayerParticipation>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_participation = &ctx.accounts.player_participation;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    // ===============================
    // VALIDATION
    // ===============================

    let is_completed = game.total_amount == 0;
    let is_buffer_expired = game.is_buffer_expired(oracle.oracle_buffer_time as u64, current_time);

    require!(
        is_completed || is_buffer_expired,
        crate::error::ErrorCode::GameWaitingForOracle
    );

    // ===============================
    // STATE UPDATES
    // ===============================

    let player_amount = player_participation.player_amount;
    let refund_amount = if is_buffer_expired && !is_completed && player_amount > 0 {
        // Process refund for uncompleted game
        ctx.accounts.player_balance.refund(player_amount);
        game.total_amount -= player_amount;
        player_amount
    } else {
        0
    };

    game.players_count -= 1;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerParticipationCleaned {
        game_key: game.key(),
        player: ctx.accounts.player.key(),
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: player_participation.player_index,
        refund_amount,
        is_completed_game: is_completed,
        timestamp: current_time,
    });

    Ok(())
}
