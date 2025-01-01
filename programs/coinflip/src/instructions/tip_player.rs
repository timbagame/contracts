use crate::events::PlayerTipped;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::TipPlayer>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.tipper_token_account.to_account_info(),
                to: ctx.accounts.receiver_token_account.to_account_info(),
                authority: ctx.accounts.tipper_vault.to_account_info(),
            },
            &[&[
                b"player_vault",
                ctx.accounts.tipper.key().as_ref(),
                ctx.accounts.game_token.token_mint.as_ref(),
                &[ctx.bumps.tipper_vault],
            ]],
        ),
        amount,
    )?;

    emit!(PlayerTipped {
        tipper: ctx.accounts.tipper.key(),
        receiver: ctx.accounts.receiver.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
