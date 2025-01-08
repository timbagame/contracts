use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::ClaimFee>) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let fee_amount = game_token.fee_amount;
    game_token.fee_amount = 0;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.game_token_account.to_account_info(),
                to: ctx.accounts.authority_token_account.to_account_info(),
                authority: ctx.accounts.game_vault.to_account_info(),
            },
            &[&[
                b"game_vault",
                ctx.accounts.game_token.token_mint.as_ref(),
                &[ctx.accounts.game_token.bump],
            ]],
        ),
        fee_amount,
    )?;

    Ok(())
}
