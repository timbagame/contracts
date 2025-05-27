use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;

    // Use helper method to handle refunds based on game type
    game.refund_player(player_balance, &ctx.accounts.creator.key());

    Ok(())
}
