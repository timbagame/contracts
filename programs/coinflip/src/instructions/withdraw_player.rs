use crate::events::PlayerWithdrawn;
use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::WithdrawPlayer>, amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.receiver_token_account.to_account_info(),
                authority: ctx.accounts.player_vault.to_account_info(),
            },
            &[&[
                b"player_vault",
                ctx.accounts.player.key().as_ref(),
                ctx.accounts.token_mint.key().as_ref(),
                &[ctx.bumps.player_vault],
            ]],
        ),
        amount,
    )?;

    emit!(PlayerWithdrawn {
        player: ctx.accounts.player.key(),
        receiver: ctx.accounts.receiver.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
