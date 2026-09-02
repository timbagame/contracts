use crate::{events::LegacyOracleClosed, state::Oracle};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::CloseLegacyOracle>) -> Result<()> {
    let oracle_account = ctx.accounts.oracle.to_account_info();
    let account_data = oracle_account.try_borrow_data()?;
    let legacy_operator = Oracle::legacy_operator(&account_data)?;
    require_keys_eq!(
        legacy_operator,
        ctx.accounts.oracle_operator.key(),
        crate::error::ErrorCode::UnauthorizedOperator
    );
    drop(account_data);

    emit!(LegacyOracleClosed {
        operator: legacy_operator,
    });

    let rent_lamports = oracle_account.lamports();
    ctx.accounts.oracle_operator.add_lamports(rent_lamports)?;
    oracle_account.sub_lamports(rent_lamports)?;
    oracle_account.assign(&system_program::ID);
    oracle_account.resize(0)?;

    Ok(())
}
