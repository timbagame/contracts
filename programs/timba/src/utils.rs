use crate::state::Oracle;
use crate::OracleConfig;
use anchor_lang::prelude::*;
use anchor_spl::token::ID as TOKEN_PROGRAM_ID;
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;

// =============================================================================
// COMMON UTILITIES
// =============================================================================

/// Retrieve the current [`Clock`] account
pub fn get_clock() -> Result<Clock> {
    // Clock::get returns Result<Clock, ProgramError>; coerce to Anchor Error
    Ok(Clock::get()?)
}

/// Get current timestamp from Solana clock - eliminates repeated `Clock::get()` calls
pub fn get_current_time() -> Result<u64> {
    Ok(get_clock()?.unix_timestamp as u64)
}

/// Get a tuple containing the current unix timestamp and slot from a single clock fetch
pub fn get_clock_snapshot() -> Result<(u64, u64)> {
    let clock = get_clock()?;
    Ok((clock.unix_timestamp as u64, clock.slot))
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

// =============================================================================
// TOKEN PROGRAM UTILITIES
// =============================================================================

/// Returns `true` if the provided program is one of the supported SPL token programs.
pub fn is_supported_token_program(program: &Pubkey) -> bool {
    program.eq(&TOKEN_PROGRAM_ID) || program.eq(&TOKEN_2022_PROGRAM_ID)
}
