use anchor_lang::prelude::*;
use anchor_spl::token;

pub fn handler(ctx: Context<super::ClaimFee>) -> Result<()> {
    let game_token = &mut ctx.accounts.game_token;
    let fee_amount = game_token.fee_amount;
    game_token.fee_amount = 0;

    // Transfer funds to winner
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.game_token_account.to_account_info(),
                to: ctx.accounts.authority_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[
                b"vault",
                ctx.accounts.game_token.token_mint.as_ref(),
                &[ctx.accounts.game_token.bump],
            ]],
        ),
        fee_amount,
    )?;

    Ok(())
}
