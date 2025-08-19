use crate::state::Oracle;
use crate::OracleConfig;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

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

// =============================================================================
// PARTICIPANT HASHING
// =============================================================================

/// Domain tag for participant hash computation (versioned for future evolution)
const PARTICIPANT_HASH_DOMAIN: &[u8] = b"timba:part:v1";

/// Computes the per-game salted participant hash as the first 8 bytes of
/// SHA256("timba:part:v1" || game_key || player_pubkey)
pub fn participant_hash(game_key: &Pubkey, player_key: &Pubkey) -> u64 {
    let mut data = Vec::with_capacity(
        PARTICIPANT_HASH_DOMAIN.len() + 32 /* game */ + 32 /* player */,
    );
    data.extend_from_slice(PARTICIPANT_HASH_DOMAIN);
    data.extend_from_slice(game_key.as_ref());
    data.extend_from_slice(player_key.as_ref());
    let digest = hash(&data).to_bytes();
    u64::from_le_bytes(digest[0..8].try_into().unwrap())
}
