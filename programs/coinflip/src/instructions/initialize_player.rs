use anchor_lang::prelude::*;

pub fn handler_regular(
    ctx: Context<super::InitializePlayer>,
    owner: Pubkey,
) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.id = ctx.accounts.oracle.players_counter;
    player.owner = owner;
    player.is_bot = false;
    player.bot_type = 0;
    player.bot_seed = String::new();
    player.bot_auth = false;
    player.games_won = 0;
    player.games_lost = 0;

    let oracle = &mut ctx.accounts.oracle;
    oracle.players_counter += 1;

    Ok(())
}

pub fn handler_bot(
    ctx: Context<super::InitializePlayerBot>,
    owner: Pubkey,
    bot_type: u8,
    bot_seed: String,
    bot_auth: bool,
) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.id = ctx.accounts.oracle.players_counter;
    player.owner = owner;
    player.is_bot = true;
    player.bot_type = bot_type;
    player.bot_seed = bot_seed;
    player.bot_auth = bot_auth;
    player.games_won = 0;
    player.games_lost = 0;

    let oracle = &mut ctx.accounts.oracle;
    oracle.players_counter += 1;

    Ok(())
}
