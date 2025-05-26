use anchor_lang::prelude::*;

use crate::state::GameType;

pub fn handler(ctx: Context<super::JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Check player token amount
    if game.game_type == GameType::Coinflip {
        crate::state::handle_player_token_transfer(
            &mut ctx.accounts.player_balance,
            game.amount,
            &ctx.accounts.player_token_account.to_account_info(),
            &ctx.accounts.game_token_account.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
        )?;
    }

    game.players.push(ctx.accounts.player.key());

    Ok(())
}
