use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::ClaimWin>) -> Result<()> {
    let player_balance = &mut ctx.accounts.player_balance;
    let amount = player_balance.amount;
    player_balance.amount = 0;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.game_token_account.to_account_info(),
                to: ctx.accounts.player_token_account.to_account_info(),
                authority: ctx.accounts.game_vault.to_account_info(),
            },
            &[&[
                b"game_vault",
                ctx.accounts.token_mint.key().as_ref(),
                &[ctx.bumps.game_vault],
            ]],
        ),
        amount,
    )?;

    Ok(())
}
