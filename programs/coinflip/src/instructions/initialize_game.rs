use crate::utils::{get_current_slot, get_current_time};
use crate::{
    error::ErrorCode,
    events::GameInitialized,
    state::{GameType, BLOOM_BITS_PER_ENTRY, BLOOM_K},
    GameConfig,
};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeGame>, config: GameConfig) -> Result<()> {
    let game: &mut Account<'_, crate::state::Game> = &mut ctx.accounts.game;
    let current_time = get_current_time()?;
    let creator_key = ctx.accounts.creator.key();
    let token_mint_key = ctx.accounts.token_mint.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    game.creator = creator_key;
    game.game_type = config.game_type;
    game.max_tickets = config.max_tickets;
    game.min_tickets = config.min_tickets;
    game.tickets_count = 0;
    game.token_mint = token_mint_key;
    game.created_at = current_time;
    game.timeout = config.timeout;
    game.last_slot = get_current_slot()?;
    game.is_private = config.is_private;

    // Set amounts based on game type
    if config.game_type == GameType::Giveaway {
        game.total_amount = config.amount;
        game.ticket_amount = 0;
    } else {
        game.total_amount = 0;
        game.ticket_amount = config.amount;
    }

    // ===============================
    // BLOOM FILTER INITIALIZATION (dynamic sizing)
    // ===============================
    let m_bits: u32 = BLOOM_BITS_PER_ENTRY
        .checked_mul(config.max_tickets)
        .ok_or(ErrorCode::InvalidTicketsCount)?;
    let words: usize = (((m_bits as usize) + 63) / 64).max(1);
    game.bloom_m_bits = m_bits;
    game.bloom_k = BLOOM_K;
    game.participants_filter = vec![0u64; words];

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    // Transfer tokens for giveaway games
    if game.ticket_amount == 0 {
        ctx.accounts.game_token.handle_token_transfer(
            ctx.accounts.creator_token_account.to_account_info(),
            ctx.accounts.game_token_account.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            config.amount,
            false,
        )?;
    }

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(GameInitialized {
        game_key: game.key(),
        creator: creator_key,
        game_type: game.game_type,
        ticket_amount: game.ticket_amount,
        total_amount: game.total_amount,
        max_tickets: game.max_tickets,
        min_tickets: game.min_tickets,
        token_mint: token_mint_key,
        is_private: game.is_private,
        created_at: game.created_at,
        timeout: game.timeout,
    });

    Ok(())
}
