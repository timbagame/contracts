use crate::error::ErrorCode;
use crate::MAX_FEE_PERCENTAGE;
use anchor_lang::prelude::*;

pub fn handler(
    ctx: Context<super::UpdateConfig>,
    new_treasury: Option<Pubkey>,
    new_game_token: Option<Pubkey>,
    new_fee_percentage: Option<u64>,
    new_operator: Option<Pubkey>,
) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == ctx.accounts.config.authority,
        ErrorCode::Unauthorized
    );

    let config = &mut ctx.accounts.config;

    if let Some(treasury) = new_treasury {
        config.treasury = treasury;
    }
    if let Some(game_token) = new_game_token {
        config.game_token = game_token;
    }
    if let Some(fee_percentage) = new_fee_percentage {
        require!(
            fee_percentage <= MAX_FEE_PERCENTAGE,
            ErrorCode::InvalidFeePercentage
        );
        config.fee_percentage = fee_percentage;
    }
    if let Some(operator) = new_operator {
        config.operator = operator;
    }

    Ok(())
}
