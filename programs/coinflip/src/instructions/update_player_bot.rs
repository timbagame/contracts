use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdatePlayerBot>, owner: Pubkey, bot_auth: bool) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.owner = owner;
    player.bot_auth = bot_auth;

    Ok(())
}
