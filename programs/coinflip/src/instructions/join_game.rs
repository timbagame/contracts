use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::error::ErrorCode;
use crate::state::GameStatus;
use crate::utils::verify_operator_signature;

pub fn handler(ctx: Context<super::JoinGame>, signature: Option<Vec<u8>>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.validate_status(GameStatus::Active)?;
    game.validate_participation(&ctx.accounts.player.key())?;

    if game.is_private {
        require!(signature.is_some(), ErrorCode::SignatureRequired);
        let mut message = Vec::with_capacity(64);
        message.extend_from_slice(&game.game_seed);
        message.extend_from_slice(&ctx.accounts.player.key().to_bytes());

        require!(
            verify_operator_signature(
                &ctx.accounts.config.operator,
                &message,
                signature.as_ref().unwrap()
            )?,
            ErrorCode::InvalidSignature
        );
    }

    if !game.is_sol {
        // Only transfer tokens for SPL games
        require!(
            ctx.accounts.player_token_account.is_some() 
            && ctx.accounts.vault_token_account.is_some() 
            && ctx.accounts.token_program.is_some(),
            ErrorCode::InvalidToken
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.as_ref().unwrap().to_account_info(),
                token::Transfer {
                    from: ctx.accounts.player_token_account.as_ref().unwrap().to_account_info(),
                    to: ctx.accounts.vault_token_account.as_ref().unwrap().to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            game.amount,
        )?;
    } else {
        // Transfer SOL for SOL games
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.vault.as_ref().unwrap().to_account_info(),
                },
            ),
            game.amount,
        )?;
    }

    game.add_participant(ctx.accounts.player.key());
    Ok(())
}
