#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc;

#[cfg(feature = "wasm")]
use alloc::vec::Vec;
use core::convert::TryInto;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(not(feature = "solana"))]
use sha2::{Digest, Sha256};
#[cfg(feature = "solana")]
use solana_sha256_hasher::hashv;

/// Size of entropy window for winner calculation (8 bytes for u64)
pub const ENTROPY_WINDOW_SIZE: usize = 8;
/// Maximum number of entropy windows that fit in a 32-byte hash
pub const MAX_ENTROPY_WINDOWS: usize = 32 - ENTROPY_WINDOW_SIZE;

#[cfg(feature = "wasm")]
fn ensure_secret_key(secret_key: &[u8]) -> Result<[u8; 32], JsValue> {
    if secret_key.len() != 32 {
        return Err(JsValue::from_str("secret key must be 32 bytes"));
    }
    Ok(secret_key.try_into().expect("checked length"))
}

#[cfg(feature = "solana")]
fn compute_entropy(secret_key: &[u8; 32], last_slot: u64) -> [u8; 32] {
    let slot_bytes = last_slot.to_le_bytes();
    hashv(&[secret_key.as_ref(), &slot_bytes]).to_bytes()
}

#[cfg(not(feature = "solana"))]
fn compute_entropy(secret_key: &[u8; 32], last_slot: u64) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(secret_key);
    hasher.update(last_slot.to_le_bytes());
    let digest = hasher.finalize();
    let mut entropy = [0u8; 32];
    entropy.copy_from_slice(&digest);
    entropy
}

/// Calculates the winner index using secret key with unbiased random selection.
pub fn calculate_winner_index(
    tickets_count: u32,
    last_slot: u64,
    secret_key: [u8; 32],
) -> Option<u32> {
    let n_entries = tickets_count as u64;

    if n_entries == 0 {
        return None;
    }

    if n_entries == 1 {
        return Some(0);
    }

    let entropy_hash = compute_entropy(&secret_key, last_slot);
    let max_valid = u64::MAX - (u64::MAX % n_entries);

    for start_pos in 0..=MAX_ENTROPY_WINDOWS {
        let random_u64 = u64::from_le_bytes(
            entropy_hash[start_pos..start_pos + ENTROPY_WINDOW_SIZE]
                .try_into()
                .unwrap(),
        );

        if random_u64 < max_valid {
            return Some((random_u64 % n_entries) as u32);
        }
    }

    None
}

/// Calculates prize distribution with fee deduction.
pub fn calculate_amounts(total_amount: u64, fee_percentage: u64) -> (u64, u64) {
    let fee_amount = (total_amount as u128 * fee_percentage as u128 / 100) as u64;
    let winner_amount = total_amount - fee_amount;
    (winner_amount, fee_amount)
}

/// Verifies the secret key matches the random hash using SHA256.
pub fn verify_secret_key(random_hash: [u8; 32], secret_key: [u8; 32]) -> bool {
    #[cfg(feature = "solana")]
    {
        hashv(&[secret_key.as_ref()]).to_bytes() == random_hash
    }

    #[cfg(not(feature = "solana"))]
    {
        let mut hasher = Sha256::new();
        hasher.update(secret_key);
        let digest = hasher.finalize();
        let mut calculated = [0u8; 32];
        calculated.copy_from_slice(&digest);
        calculated == random_hash
    }
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn winner_index_from_secret(secret_key: &[u8], last_slot: u64, tickets_count: u32) -> i32 {
    match ensure_secret_key(secret_key)
        .ok()
        .and_then(|key| calculate_winner_index(tickets_count, last_slot, key))
    {
        Some(index) => index as i32,
        None => -1,
    }
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn payout_breakdown(total_amount: u64, fee_percentage: u64) -> JsValue {
    let (winner_amount, fee_amount) = calculate_amounts(total_amount, fee_percentage);
    let mut result = Vec::with_capacity(2);
    result.push(JsValue::from_str(&winner_amount.to_string()));
    result.push(JsValue::from_str(&fee_amount.to_string()));
    JsValue::from(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_fee_split() {
        let (winner, fee) = calculate_amounts(1_000, 5);
        assert_eq!(winner, 950);
        assert_eq!(fee, 50);
    }

    #[test]
    fn winner_index_stable() {
        let secret = [7u8; 32];
        let index = calculate_winner_index(10, 12345, secret).unwrap();
        assert!(index < 10);
    }

    #[test]
    fn verify_secret_hash() {
        let secret = [5u8; 32];
        #[cfg(feature = "solana")]
        let hash = solana_sha256_hasher::hashv(&[secret.as_ref()]).to_bytes();

        #[cfg(not(feature = "solana"))]
        let hash = {
            let mut hasher = Sha256::new();
            hasher.update(secret);
            let digest = hasher.finalize();
            let mut output = [0u8; 32];
            output.copy_from_slice(&digest);
            output
        };
        assert!(verify_secret_key(hash, secret));
    }
}
