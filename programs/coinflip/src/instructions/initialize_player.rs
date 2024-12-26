use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::InitializePlayer>,
    owner: Pubkey,
    bot_type: u8,
    bot_seed: String,
    bot_auth: bool,
) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.id = ctx.accounts.oracle.players_counter;
    player.owner = owner;
    player.games_won = 0;
    player.games_lost = 0;
    player.bot_type = bot_type;
    player.bot_seed = bot_seed;
    player.bot_auth = bot_auth;

    let oracle = &mut ctx.accounts.oracle;
    oracle.players_counter += 1;

    Ok(())
}
