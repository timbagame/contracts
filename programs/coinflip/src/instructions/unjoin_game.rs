use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::{GameStatus, GameType};

pub fn handler(ctx: Context<super::UnjoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Require game to not be ReadyForClaim
    require!(
        game.status != GameStatus::ReadyForClaim,
        ErrorCode::GameReadyForClaim
    );

    // Require game to not be Completed
    require!(
        game.status != GameStatus::Completed,
        ErrorCode::GameCompleted
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

    // Allow cancellation if game is not full, or if timeout has passed
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        !game.is_ready_for_oracle() || current_time >= game.created_at + game.timeout_duration,
        ErrorCode::GameFull
    );

    // If timeout has passed, mark game as cancelled
    if current_time >= game.created_at + game.timeout_duration && game.status == GameStatus::Active
    {
        game.status = GameStatus::Cancelled;
    }

    // Remove participant
    if let Some(pos) = game.participants.iter().position(|x| x == &participant) {
        game.participants.remove(pos);
    }

    // Only return tokens if it's a coinflip game
    if game.game_type == GameType::Coinflip {
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
    }

    Ok(())
}
