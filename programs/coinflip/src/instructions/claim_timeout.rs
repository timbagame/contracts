use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::GameStatus;

pub fn handler(ctx: Context<super::ClaimTimeout>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let current_time = Clock::get()?.unix_timestamp;

    require!(
        current_time >= game.created_at + game.timeout_duration,
        ErrorCode::TimeoutNotReached
    );

    // Verify participant is in the game
    let participant = ctx.accounts.participant_token_account.owner;
    require!(
        game.participants.contains(&participant),
        ErrorCode::InvalidParticipant
    );

    // Get vault PDA and bump
    let (vault_pda, bump) =
        Pubkey::find_program_address(&[b"vault", game.key().as_ref()], ctx.program_id);
    require!(
        ctx.accounts.vault.key() == vault_pda,
        ErrorCode::InvalidVault
    );

    // Return SPL tokens to participant
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.participant_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[b"vault", game.key().as_ref(), &[bump]]],
        ),
        game.amount,
    )?;

    // Remove participant from game after refund
    if let Some(pos) = game.participants.iter().position(|x| x == &participant) {
        game.participants.remove(pos);
    }

    // If all participants have claimed, mark game as cancelled
    if game.participants.is_empty() {
        game.status = GameStatus::Cancelled;
    }

    Ok(())
}
