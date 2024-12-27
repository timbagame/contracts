use anchor_lang::prelude::*;

use crate::state::GameStatus;

pub fn handler(ctx: Context<super::ClaimWin>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    game.status = GameStatus::Completed;

    

    Ok(())
}
