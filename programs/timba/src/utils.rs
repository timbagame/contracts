use crate::state::Oracle;
use crate::OracleConfig;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use solana_sha256_hasher::hashv;

// =============================================================================
// COMMON UTILITIES
// =============================================================================

/// Verify that the provided account matches the expected associated token address
pub fn assert_ata(account: Pubkey, authority: Pubkey, mint: Pubkey, token_program: Pubkey) -> bool {
    account == get_associated_token_address_with_program_id(&authority, &mint, &token_program)
}

/// Retrieve the current [`Clock`] account
pub fn get_clock() -> Result<Clock> {
    // Clock::get returns Result<Clock, ProgramError>; coerce to Anchor Error
    Ok(Clock::get()?)
}

/// Get current timestamp from Solana clock - eliminates repeated `Clock::get()` calls
pub fn get_current_time() -> Result<u64> {
    Ok(get_clock()?.unix_timestamp as u64)
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
    let digest = hashv(&[
        PARTICIPANT_HASH_DOMAIN,
        game_key.as_ref(),
        player_key.as_ref(),
    ])
    .to_bytes();
    u64::from_le_bytes(digest[0..8].try_into().unwrap())
}
