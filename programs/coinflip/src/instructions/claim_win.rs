use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::ClaimWin>, max_transfers: usize) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Process only max_transfers accounts at a time
    for player_id in game
        .players
        .iter()
        .skip(game.processed_transfers)
        .take(max_transfers)
    {
        let player_pda = Pubkey::find_program_address(
            &[
                b"player",
                player_id.to_le_bytes().as_ref(),
            ]
        );

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: player_pda.to_account_info(),
                    to: ctx.accounts.winner_token_account.to_account_info(),
                    authority: player_pda.to_account_info(),
                },
                &[&[b"player", player_id.to_le_bytes().as_ref()]],
            ),
            game.amount,
        )?;

        game.processed_transfers += 1;
    }

    // Only mark as completed if this was the last batch
    if game.processed_transfers >= game.players.len() {
        game.status = GameStatus::Completed;
    }

    Ok(())
}
