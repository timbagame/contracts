use anchor_lang::prelude::*;

/// Returns the current unix timestamp and slot from a single clock fetch
pub fn get_clock_snapshot() -> Result<(u64, u64)> {
    let clock = Clock::get()?;
    let current_time =
        u64::try_from(clock.unix_timestamp).map_err(|_| ProgramError::InvalidArgument)?;
    Ok((current_time, clock.slot))
}
