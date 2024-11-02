use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::state::*;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 32 + 8 + 32 + 32)]
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
    #[account(mut)]
    pub config: Account<'info, ProgramConfig>,
    #[account(constraint = config.authority == authority.key())]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub config: Account<'info, ProgramConfig>,
    #[account(constraint = config.authority == authority.key())]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(init, payer = creator, space = 8 + 32 + 1 + 8 + 1 + 32 * 10 + 33 + 1 + 32 + 33 + 1 + 8 + 8 + 1 + 64 * 10)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub config: Account<'info, ProgramConfig>,
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut)]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub config: Account<'info, ProgramConfig>,
}

#[derive(Accounts)]
pub struct SetOracleHash<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub config: Account<'info, ProgramConfig>,
    pub oracle: Signer<'info>,
    /// CHECK: Used for randomness
    pub recent_blockhash: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub winner: Signer<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA for vault authority
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub participant_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA for vault authority
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    pub config: Account<'info, ProgramConfig>,
    #[account(constraint = config.operator == operator.key())]
    pub operator: Signer<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub operator_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA for vault authority
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}
