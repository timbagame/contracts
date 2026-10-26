use crate::{events::OracleUpdated, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateOracle>, config: OracleConfig) -> Result<()> {
    let old_operator_key = ctx.accounts.old_oracle_operator.key();
    let new_operator_key = ctx.accounts.new_oracle_operator.key();

    ctx.accounts.oracle.update_config(&config, new_operator_key);

    emit!(OracleUpdated::from_config(
        old_operator_key,
        new_operator_key,
        &config,
    ));

    Ok(())
}
