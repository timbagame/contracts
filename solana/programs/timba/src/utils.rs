use crate::state::Oracle;
use crate::OracleConfig;
use anchor_lang::prelude::*;

// COMMON UTILITIES

/// Retrieve the current [`Clock`] account
pub fn get_clock() -> Result<Clock> {
    // Clock::get returns Result<Clock, ProgramError>; coerce to Anchor Error
    Ok(Clock::get()?)
}

/// Get current timestamp from Solana clock - eliminates repeated `Clock::get()` calls
pub fn get_current_time() -> Result<u64> {
    u64::try_from(get_clock()?.unix_timestamp).map_err(|_| ProgramError::InvalidArgument.into())
}

/// Get a tuple containing the current unix timestamp and slot from a single clock fetch
pub fn get_clock_snapshot() -> Result<(u64, u64)> {
    let clock = get_clock()?;
    Ok((
        u64::try_from(clock.unix_timestamp).map_err(|_| ProgramError::InvalidArgument)?,
        clock.slot,
    ))
}

// ORACLE CONFIGURATION UTILITIES

/// Update oracle configuration - shared by initialize and update handlers
pub fn update_oracle_configuration(
    oracle: &mut Oracle,
    config: &OracleConfig,
    operator_key: Pubkey,
) {
    oracle.update_config(config, operator_key);
}
