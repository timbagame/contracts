use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializePlayer>) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.id = ctx.accounts.oracle.players_counter;
    player.owner = ctx.accounts.owner.key();
    player.games_won = 0;

    let oracle = &mut ctx.accounts.oracle;
    oracle.players_counter += 1;

    Ok(())
}
