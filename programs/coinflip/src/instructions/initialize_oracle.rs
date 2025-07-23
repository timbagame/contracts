use crate::{events::OracleInitialized, OracleConfig};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeOracle>, config: OracleConfig) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let operator_key = ctx.accounts.oracle_operator.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_tickets,
        config.max_timeout,
        config.min_timeout,
        config.filter_cleanup_buffer,
        operator_key,
    );

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(OracleInitialized {
        operator: operator_key,
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_tickets: config.max_tickets,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
