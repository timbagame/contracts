use crate::state::Oracle;
use crate::OracleConfig;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn participant_hash_matches_expected_digest_prefix() {
        let game = Pubkey::new_unique();
        let player = Pubkey::new_unique();

        let digest = hashv(&[
            super::PARTICIPANT_HASH_DOMAIN,
            game.as_ref(),
            player.as_ref(),
        ])
        .to_bytes();
        let expected = u64::from_le_bytes(digest[0..8].try_into().unwrap());

        assert_eq!(participant_hash(&game, &player), expected);
    }

    #[test]
    fn participant_hash_is_domain_separated() {
        let game = Pubkey::new_unique();
        let player = Pubkey::new_unique();

        let alternate_digest = hashv(&[game.as_ref(), player.as_ref()]).to_bytes();
        let without_domain = u64::from_le_bytes(alternate_digest[0..8].try_into().unwrap());

        assert_ne!(participant_hash(&game, &player), without_domain);
    }
}
