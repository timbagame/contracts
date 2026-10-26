use crate::utils::get_clock_snapshot;
use crate::{events::GameCreated, GameConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CreateGame>, config: GameConfig) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let (current_time, current_slot) = get_clock_snapshot()?;

    game.initialize(
        ctx.accounts.creator.key(),
        ctx.accounts.game_vault_ctx.token_mint.key(),
        &config,
        current_time,
        current_slot,
    );

    // Transfer tokens for giveaway games
    if game.ticket_amount == 0 {
        ctx.accounts.game_vault_ctx.transfer_from_player(
            &ctx.accounts.creator_token_account,
            &ctx.accounts.creator,
            config.amount,
        )?;
    }

    emit!(GameCreated::new(game));

    Ok(())
}
