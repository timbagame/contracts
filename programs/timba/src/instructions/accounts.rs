use anchor_lang::prelude::*;
use anchor_spl::token::ID as TOKEN_PROGRAM_ID;
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::ErrorCode;
use crate::state::*;
use crate::utils::assert_ata;

// =============================================================================
// ORACLE MANAGEMENT
// =============================================================================

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u64, max_tickets: u32, max_timeout: u64, min_timeout: u64)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = oracle_operator,
        space = ORACLE_SIZE,
        seeds = [ORACLE_SEED],
        bump,
        constraint = Oracle::is_valid_fee_percentage(fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = Oracle::is_valid_buffer_time(oracle_buffer_time) @ ErrorCode::OracleBufferTooSmall,
        constraint = Oracle::is_valid_timeout(max_timeout, min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = Oracle::is_valid_tickets_count(max_tickets) @ ErrorCode::InvalidTicketsCount,
    )]
    pub oracle: Account<'info, Oracle>,

    #[account(mut)]
    pub oracle_operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u64, max_tickets: u32, max_timeout: u64, min_timeout: u64)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&old_oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
        constraint = Oracle::is_valid_fee_percentage(fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = Oracle::is_valid_buffer_time(oracle_buffer_time) @ ErrorCode::OracleBufferTooSmall,
        constraint = Oracle::is_valid_timeout(max_timeout, min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = Oracle::is_valid_tickets_count(max_tickets) @ ErrorCode::InvalidTicketsCount,
    )]
    pub oracle: Account<'info, Oracle>,

    pub old_oracle_operator: Signer<'info>,
    pub new_oracle_operator: Signer<'info>,
}

// =============================================================================
// TOKEN MANAGEMENT
// =============================================================================

#[derive(Accounts)]
#[instruction(min_amount: u64, enabled: bool)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = oracle_operator,
        space = GAME_TOKEN_SIZE,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,

    #[account(
        constraint = assert_ata(
            game_token_account.key(),
            game_vault.key(),
            token_mint.key(),
            token_program.key()
        ) @ ErrorCode::InvalidTokenAccount,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,

    #[account(mut)]
    pub oracle_operator: Signer<'info>,

    pub system_program: Program<'info, System>,
    #[account(
        constraint = token_program.key() == TOKEN_PROGRAM_ID
            || token_program.key() == TOKEN_2022_PROGRAM_ID @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(min_amount: u64, enabled: bool)]
pub struct UpdateToken<'info> {
    #[account(
        mut,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
        constraint = game_token.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game_token: Account<'info, GameToken>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,

    pub oracle_operator: Signer<'info>,
}

// =============================================================================
// GAME MANAGEMENT
// =============================================================================

#[derive(Accounts)]
#[instruction(game_type: GameType, amount: u64, max_tickets: u32, min_tickets: u32, timeout: u64, is_private: bool, random_hash: [u8; 32])]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = creator,
        // Base + participant_hashes vec prefix + 8 bytes per ticket
        space = GAME_BASE_SIZE
            + 4
            + (max_tickets as usize * 8),
        seeds = [GAME_SEED, random_hash.as_ref()],
        bump,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
        constraint = game_token.meets_min_amount(amount) @ ErrorCode::InvalidAmount,
        constraint = oracle.is_valid_timeout_range(timeout) @ ErrorCode::InvalidTimeout,
        constraint = Game::is_valid_tickets_count(max_tickets, min_tickets, oracle.max_tickets) @ ErrorCode::InvalidTicketsCount,
        constraint = Game::is_valid_game_type_tickets(game_type, max_tickets, min_tickets) @ ErrorCode::InvalidTicketsCount,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
        constraint = game_token.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        constraint = assert_ata(
            creator_token_account.key(),
            creator.key(),
            token_mint.key(),
            token_program.key()
        ) @ ErrorCode::InvalidTokenAccount,
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = game_token_account.key() == game_token.vault_token_account
            @ ErrorCode::InvalidTokenAccount,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    #[account(
        constraint = token_program.key() == TOKEN_PROGRAM_ID
            || token_program.key() == TOKEN_2022_PROGRAM_ID @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        constraint = game.is_not_full() @ ErrorCode::GameFull,
        constraint = game.can_join_private(oracle_operator.as_ref(), &oracle.operator) @ ErrorCode::PrivateGameAccessDenied,
        constraint = game.has_sufficient_balance_for_join(player_token_account.amount) @ ErrorCode::InsufficientBalance,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        constraint = game.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,
    pub oracle_operator: Option<Signer<'info>>,
    #[account(
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
        constraint = game_token.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        constraint = assert_ata(
            player_token_account.key(),
            player.key(),
            token_mint.key(),
            token_program.key()
        ) @ ErrorCode::InvalidTokenAccount,
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = game_token_account.key() == game_token.vault_token_account
            @ ErrorCode::InvalidTokenAccount,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    #[account(
        constraint = token_program.key() == TOKEN_PROGRAM_ID
            || token_program.key() == TOKEN_2022_PROGRAM_ID @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(random_hash: [u8; 32], secret_key: [u8; 32], winner_index: u32)]
pub struct CompleteGame<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [GAME_SEED, random_hash.as_ref()],
        bump,
        constraint = game.is_creator(&creator.key()) @ ErrorCode::InvalidCreator,
        constraint = Game::verify_secret_key(random_hash, secret_key) @ ErrorCode::InvalidSecretKey,
        constraint = game.total_amount > 0 @ ErrorCode::GameAlreadyCompleted,
    )]
    pub game: Account<'info, Game>,
    #[account(
        constraint = game.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,
    pub oracle_operator: Signer<'info>,
    /// CHECK: Validated by merkle proof verification
    #[account(mut)]
    pub winner: AccountInfo<'info>,
    /// CHECK: Game creator for rent refund
    #[account(mut)]
    pub creator: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
        constraint = game_token.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        constraint = assert_ata(
            winner_token_account.key(),
            winner.key(),
            token_mint.key(),
            token_program.key()
        ) @ ErrorCode::InvalidTokenAccount,
    )]
    pub winner_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = game_token_account.key() == game_token.vault_token_account
            @ ErrorCode::InvalidTokenAccount,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    #[account(
        constraint = token_program.key() == TOKEN_PROGRAM_ID
            || token_program.key() == TOKEN_2022_PROGRAM_ID @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        constraint = game.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    #[account(
        mut,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        constraint = assert_ata(
            player_token_account.key(),
            player.key(),
            token_mint.key(),
            token_program.key()
        ) @ ErrorCode::InvalidTokenAccount,
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = game_token_account.key() == game_token.vault_token_account
            @ ErrorCode::InvalidTokenAccount,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    #[account(
        constraint = token_program.key() == TOKEN_PROGRAM_ID
            || token_program.key() == TOKEN_2022_PROGRAM_ID @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CloseGame<'info> {
    #[account(
        mut,
        close = creator,
        constraint = game.is_creator(&creator.key()) @ ErrorCode::InvalidCreator,
        constraint = game.tickets_count == 0 @ ErrorCode::GameHasActivePlayers,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        constraint = game.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    #[account(
        mut,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        constraint = assert_ata(
            creator_token_account.key(),
            creator.key(),
            token_mint.key(),
            token_program.key()
        ) @ ErrorCode::InvalidTokenAccount,
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = game_token_account.key() == game_token.vault_token_account
            @ ErrorCode::InvalidTokenAccount,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    #[account(
        constraint = token_program.key() == TOKEN_PROGRAM_ID
            || token_program.key() == TOKEN_2022_PROGRAM_ID @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
}

// =============================================================================
// FEE MANAGEMENT
// =============================================================================

#[derive(Accounts)]
pub struct WithdrawTokenFee<'info> {
    #[account(
        mut,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,
    pub oracle_operator: Signer<'info>,
    #[account(
        mut,
        constraint = assert_ata(
            oracle_operator_token_account.key(),
            oracle_operator.key(),
            token_mint.key(),
            token_program.key()
        ) @ ErrorCode::InvalidTokenAccount,
    )]
    pub oracle_operator_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = game_token_account.key() == game_token.vault_token_account
            @ ErrorCode::InvalidTokenAccount,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    #[account(
        constraint = token_program.key() == TOKEN_PROGRAM_ID
            || token_program.key() == TOKEN_2022_PROGRAM_ID @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
}
