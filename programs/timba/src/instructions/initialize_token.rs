use crate::{error::ErrorCode, events::TokenInitialized, TokenConfig};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, StateWithExtensions},
    state::Mint,
};

fn validate_token_2022_mint(ctx: &Context<super::InitializeToken>) -> Result<()> {
    if ctx.accounts.token_program.key() != anchor_spl::token_2022::ID {
        return Ok(());
    }

    let mint_info = ctx.accounts.token_mint.to_account_info();
    let mint_data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<Mint>::unpack(&mint_data)
        .map_err(|_| error!(ErrorCode::InvalidTokenMint))?;
    let extension_types = mint
        .get_extension_types()
        .map_err(|_| error!(ErrorCode::InvalidTokenMint))?;

    require!(
        extension_types.is_empty(),
        ErrorCode::UnsupportedTokenExtension
    );
    Ok(())
}

pub fn handler(ctx: Context<super::InitializeToken>, config: TokenConfig) -> Result<()> {
    validate_token_2022_mint(&ctx)?;

    let game_token = &mut ctx.accounts.game_token;
    let token_mint_key = ctx.accounts.token_mint.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    game_token.initialize(
        token_mint_key,
        ctx.bumps.game_vault,
        config.min_amount,
        config.enabled,
    );

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(TokenInitialized::from_config(token_mint_key, &config));

    Ok(())
}
