use crate::error::ErrorCode;
use crate::events::PlayerUnjoined;
use crate::utils::{get_clock_snapshot, participant_hash};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    let oracle = &ctx.accounts.oracle;
    let (current_time, current_slot) = get_clock_snapshot()?;
    let player_key = ctx.accounts.player.key();
    let token_mint = &ctx.accounts.game_token_ctx.token_mint;
    let token_decimals = token_mint.decimals;

    // ===============================
    // VALIDATION
    // ===============================

    // Late unjoin only allowed after: (timeout + oracle buffer). Prevents strategic exits.
    require!(
        game.is_buffer_expired(oracle.oracle_buffer_time, current_time),
        ErrorCode::OracleBufferNotExpired
    );

    // No need to check completion explicitly: completed games are closed (see CompleteGame: close = creator)

    // ===============================
    // STATE UPDATES
    // ===============================

    // Find salted participant hash and remove if present (single ticket per player)
    let player_hash = participant_hash(&game.key(), &player_key);
    let removed_index = game.remove_participant(player_hash)?;
    game.last_slot = current_slot;

    // Refund player directly
    ctx.accounts
        .game_token_ctx
        .game_token
        .handle_token_transfer(
            ctx.accounts
                .game_token_ctx
                .game_token_account
                .to_account_info(),
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_ctx.game_vault.to_account_info(),
            ctx.accounts.game_token_ctx.token_program.to_account_info(),
            token_mint.to_account_info(),
            game.ticket_amount,
            token_decimals,
            true,
        )?;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerUnjoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        tickets_count: game.tickets_count,
        ticket_index: removed_index as u32,
        last_slot: current_slot,
        timestamp: current_time,
    });

    Ok(())
}
