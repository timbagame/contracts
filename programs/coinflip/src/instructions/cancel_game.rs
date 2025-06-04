use crate::{events::GameCancelled, state::GameType};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &ctx.accounts.game;
    let creator_balance = &mut ctx.accounts.creator_balance;

    // Refund creator for giveaway games
    if game.game_type == GameType::Giveaway {
        creator_balance.refund(game.amount);
    }

    emit!(GameCancelled {
        game_key: game.key(),
        creator: game.creator,
        game_type: game.game_type,
        amount: game.amount,
        token_mint: game.token_mint,
    });

    Ok(())
}
