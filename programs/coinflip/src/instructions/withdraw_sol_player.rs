use crate::events::PlayerWithdrawn;
use anchor_lang::prelude::*;
use anchor_lang::system_program;

pub fn handler(ctx: Context<super::WithdrawSolPlayer>, amount: u64) -> Result<()> {
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player_vault.to_account_info(),
                to: ctx.accounts.receiver.to_account_info(),
            },
            &[&[
                b"player_vault",
                ctx.accounts.player.key().as_ref(),
                &[ctx.bumps.player_vault],
            ]],
        ),
        amount,
    )?;

    emit!(PlayerWithdrawn {
        player: ctx.accounts.player.key(),
        receiver: ctx.accounts.receiver.key(),
        token_mint: Pubkey::default(),
        amount,
    });

    Ok(())
}
