use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::GameStatus;

pub fn handler(ctx: Context<super::ClaimWinnings>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    
    require!(
        game.status == GameStatus::ReadyForClaim,
        ErrorCode::GameNotReadyForClaim
    );
    require!(
        game.winner.unwrap() == ctx.accounts.winner.key(),
        ErrorCode::NotWinner
    );

    let total_pot = game.amount * (game.max_participants as u64);
    let fee_amount = (total_pot * ctx.accounts.config.fee_percentage) / 100;
    let winner_amount = total_pot - fee_amount;

    // Get vault PDA and bump
    let (vault_pda, bump) = Pubkey::find_program_address(
        &[b"vault", game.key().as_ref()],
        ctx.program_id
    );
    require!(
        ctx.accounts.vault.key() == vault_pda,
        ErrorCode::InvalidVault
    );

    // Transfer winnings to winner
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[b"vault", game.key().as_ref(), &[bump]]]
        ),
        winner_amount,
    )?;

    // Transfer fees to treasury
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[b"vault", game.key().as_ref(), &[bump]]]
        ),
        fee_amount,
    )?;

    game.status = GameStatus::Completed;
    Ok(())
}
