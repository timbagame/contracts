use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializePlayerBot>,
    bot_id: u8,
    bot_seed: String,
) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.id = ctx.accounts.oracle.players_counter;
    player.is_bot = true;
    player.bot_id = bot_id;
    player.bot_seed = bot_seed;
    player.bot_auth = true;
    player.games_won = 0;

    let oracle = &mut ctx.accounts.oracle;
    oracle.players_counter += 1;

    Ok(())
}
