use crate::error::ErrorCode;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.config.authority,
        ErrorCode::Unauthorized
    );

    ctx.accounts.config.authority = new_authority;
    Ok(())
}
