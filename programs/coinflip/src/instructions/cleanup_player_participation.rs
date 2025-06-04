use anchor_lang::prelude::*;

pub fn handler(_ctx: Context<super::CleanupPlayerParticipation>) -> Result<()> {
    // All logic handled by constraints: game completion check, PDA validation, account closure
    Ok(())
}
