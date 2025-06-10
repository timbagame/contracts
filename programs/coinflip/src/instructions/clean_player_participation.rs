use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CleanPlayerParticipation>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Decrement players count as this player participation is being cleaned
    game.players_count -= 1;

    Ok(())
}
