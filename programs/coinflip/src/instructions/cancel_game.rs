use anchor_lang::prelude::*;

use crate::state::GameStatus;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.status = GameStatus::Cancelled;

    Ok(())
}
