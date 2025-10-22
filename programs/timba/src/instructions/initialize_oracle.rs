use crate::utils::update_oracle_configuration;
use crate::{events::OracleInitialized, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeOracle>, config: OracleConfig) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let operator_key = ctx.accounts.oracle_operator.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    update_oracle_configuration(oracle, &config, operator_key);

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(OracleInitialized::from_config(operator_key, &config));

    Ok(())
}
