use crate::events::OracleClosed;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CloseOracle>) -> Result<()> {
    emit!(OracleClosed {
        operator: ctx.accounts.oracle_operator.key(),
    });

    Ok(())
}
