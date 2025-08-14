use crate::error::ErrorCode;
use crate::events::PlayerJoined;
use crate::utils::{get_current_slot, get_current_time};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let current_time = get_current_time()?;
    let player_key = ctx.accounts.player.key();

    // ===============================
    // VALIDATION
    // ===============================

    require!(!game.is_expired(current_time), ErrorCode::GameExpired);

    // Duplicate prevention: scan exact hash list
    let hash_bytes = hash(player_key.as_ref()).to_bytes();
    let participant_hash = u64::from_le_bytes(hash_bytes[0..8].try_into().unwrap());
    if game
        .participant_hashes
        .iter()
        .any(|h| *h == participant_hash)
    {
        return err!(ErrorCode::AlreadyJoined);
    }

    // ===============================
    // STATE UPDATES
    // ===============================

    // Add player to game and update counters
    game.add_player_to_game()?;
    game.last_slot = get_current_slot()?;

    // Append hash
    game.participant_hashes.push(participant_hash);

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    if game.ticket_amount > 0 {
        ctx.accounts.game_token.handle_token_transfer(
            ctx.accounts.player_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.player.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            game.ticket_amount,
            false,
        )?;
    }

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerJoined {
        game_key: game.key(),
        player: player_key,
        total_amount: game.total_amount,
        tickets_count: game.tickets_count,
        ticket_index: game.tickets_count - 1, // Just joined, so index is tickets_count - 1
        last_slot: game.last_slot,
        timestamp: current_time,
    });

    Ok(())
}
