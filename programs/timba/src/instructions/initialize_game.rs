use crate::utils::get_clock_snapshot;
use crate::{events::GameInitialized, GameConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeGame>, config: GameConfig) -> Result<()> {
    let game: &mut Account<'_, crate::state::Game> = &mut ctx.accounts.game;
    let (current_time, current_slot) = get_clock_snapshot()?;
    let creator_key = ctx.accounts.creator.key();
    let token_mint = &ctx.accounts.game_token_ctx.token_mint;
    let token_mint_key = token_mint.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    game.initialize(
        creator_key,
        token_mint_key,
        &config,
        current_time,
        current_slot,
    );

    // ===============================
    // TOKEN TRANSFER
    // ===============================

    // Transfer tokens for giveaway games
    if game.ticket_amount == 0 {
        ctx.accounts.game_token_ctx.transfer_from_player(
            &ctx.accounts.creator_token_account,
            &ctx.accounts.creator,
            config.amount,
        )?;
    }

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(GameInitialized::new(game, creator_key));

    Ok(())
}
