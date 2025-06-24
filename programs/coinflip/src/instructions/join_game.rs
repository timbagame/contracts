use crate::events::PlayerJoined;
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::JoinGame>,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;
    let player_balance = &mut ctx.accounts.player_balance;
    let player_key = ctx.accounts.player.key();

    // ===============================
    // VALIDATION
    // ===============================

    require!(
        !game.is_expired(current_time),
        crate::error::ErrorCode::GameExpired
    );

    // ===============================
    // MERKLE TREE UPDATE
    // ===============================

    // Add player to merkle tree
    game.add_player_to_merkle_tree(player_key)?;

    // Update game state
    game.last_slot = clock.slot;

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if game.ticket_amount > 0 {
        player_balance.handle_token_transfer(
            game.ticket_amount,
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        )?;
    }

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerJoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        players_count: game.players_count,
        player_index: game.players_count - 1, // Just joined, so index is players_count - 1
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
