use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Return full funds without charging any fee when cancelling
    let player_balance = &mut ctx.accounts.player_balance;
    player_balance.amount += game.amount;

    Ok(())
}
