use anchor_lang::prelude::*;

use crate::state::GameType;

#[event]
pub struct GameCancelled {
    pub game_key: Pubkey,
    pub creator: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub token_mint: Pubkey,
}

pub fn handler(ctx: Context<super::CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let player_balance = &mut ctx.accounts.player_balance;

    // Use helper method to handle refunds based on game type
    game.refund_player(player_balance, &ctx.accounts.creator.key());

    emit!(GameCancelled {
        game_key: game.key(),
        creator: game.creator,
        game_type: game.game_type,
        amount: game.amount,
        token_mint: game.token_mint,
    });

    Ok(())
}
