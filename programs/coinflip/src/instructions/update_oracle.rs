use crate::OracleConfig;
use anchor_lang::prelude::*;

#[event]
pub struct OracleUpdated {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub fee_percentage: u8,
    pub oracle_buffer_time: u16,
    pub max_players: u8,
    pub max_timeout: u32,
    pub min_timeout: u32,
}

pub fn handler(ctx: Context<super::UpdateOracle>, config: OracleConfig) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.update_config(
        config.fee_percentage,
        config.oracle_buffer_time,
        config.max_players,
        config.max_timeout,
        config.min_timeout,
        ctx.accounts.new_authority.key(),
    );

    emit!(OracleUpdated {
        old_authority: ctx.accounts.old_authority.key(),
        new_authority: ctx.accounts.new_authority.key(),
        fee_percentage: config.fee_percentage,
        oracle_buffer_time: config.oracle_buffer_time,
        max_players: config.max_players,
        max_timeout: config.max_timeout,
        min_timeout: config.min_timeout,
    });

    Ok(())
}
