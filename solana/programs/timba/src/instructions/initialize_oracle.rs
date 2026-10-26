use crate::{events::OracleInitialized, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeOracle>, config: OracleConfig) -> Result<()> {
    let operator_key = ctx.accounts.oracle_operator.key();

    ctx.accounts.oracle.update_config(&config, operator_key);

    emit!(OracleInitialized::from_config(operator_key, &config));

    Ok(())
}
