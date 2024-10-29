use anchor_lang::prelude::*;
use anchor_lang::solana_program::{ed25519_program, instruction::Instruction, program::invoke};

pub fn verify_operator_signature(
    operator_pubkey: &Pubkey,
    message: &[u8],
    signature: &[u8],
) -> Result<bool> {
    if signature.len() != 64 {
        return Ok(false);
    }

    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(signature);

    let mut instruction_data = Vec::with_capacity(signature.len() + message.len() + 32);
    instruction_data.extend_from_slice(&sig_bytes);
    instruction_data.extend_from_slice(message);
    instruction_data.extend_from_slice(&operator_pubkey.to_bytes());

    let ix = Instruction::new_with_bytes(
        ed25519_program::id(),
        &instruction_data,
        vec![], // No account keys needed
    );

    match invoke(&ix, &[]) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
