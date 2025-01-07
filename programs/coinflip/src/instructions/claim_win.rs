use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::ClaimWin>) -> Result<()> {
    let player_token = &mut ctx.accounts.player_token;
    let game_token = &mut ctx.accounts.game_token;
    let amount = player_token.amount;
    player_token.amount = 0;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.game_token_account.to_account_info(),
                to: ctx.accounts.player_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[
                b"vault",
                game_token.token_mint.as_ref(),
                &[game_token.bump],
            ]],
        ),
        amount,
    )?;

    Ok(())
}
