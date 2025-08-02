use crate::{events::OracleUpdated, OracleConfig};
use crate::utils::update_oracle_configuration;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::UpdateOracle>, config: OracleConfig) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let old_operator_key = ctx.accounts.old_oracle_operator.key();
    let new_operator_key = ctx.accounts.new_oracle_operator.key();

    // ===============================
    // STATE UPDATES
    // ===============================

    update_oracle_configuration(oracle, &config, new_operator_key);

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(OracleUpdated {
        old_operator: old_operator_key,
        new_operator: new_operator_key,
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_tickets: config.max_tickets,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
