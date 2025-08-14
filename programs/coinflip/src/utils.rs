use crate::state::Oracle;
use crate::OracleConfig;
use anchor_lang::prelude::*;

// =============================================================================
// COMMON UTILITIES
// =============================================================================

/// Get current timestamp from Solana clock - eliminates repeated Clock::get() calls
pub fn get_current_time() -> Result<u64> {
    Ok(Clock::get()?.unix_timestamp as u64)
}

/// Get current slot from Solana clock
pub fn get_current_slot() -> Result<u64> {
    Ok(Clock::get()?.slot)
}

// =============================================================================
// ORACLE CONFIGURATION UTILITIES
// =============================================================================

/// Update oracle configuration - shared by initialize and update handlers
pub fn update_oracle_configuration(
    oracle: &mut Oracle,
    config: &OracleConfig,
    operator_key: Pubkey,
) {
    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_tickets,
        config.max_timeout,
        config.min_timeout,

        operator_key,
    );
}
