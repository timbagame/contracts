use anchor_lang::prelude::*;

declare_id!("9dWCi3pk3iZXaDtchUzNBD7km4163YkaD9iH2rypz3k6");

#[program]
pub mod timba {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
