use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::ErrorCode;
#[allow(clippy::wildcard_imports)]
use crate::state::*;
use crate::utils::is_supported_token_program;
use crate::{GameConfig, OracleConfig, TokenConfig};

// ORACLE MANAGEMENT

#[derive(Accounts)]
#[instruction(config: OracleConfig)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = oracle_operator,
        space = ORACLE_SIZE,
        seeds = [ORACLE_SEED],
        bump,
        constraint = Oracle::is_valid_fee_percentage(config.fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = Oracle::is_valid_buffer_time(config.oracle_buffer_time) @ ErrorCode::OracleBufferTooSmall,
        constraint = Oracle::is_valid_timeout(config.max_timeout, config.min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = Oracle::is_valid_tickets_count(config.max_tickets) @ ErrorCode::InvalidTicketsCount,
    )]
    pub oracle: Account<'info, Oracle>,

    #[account(mut)]
    pub oracle_operator: Signer<'info>,

    pub upgrade_authority: Signer<'info>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ ErrorCode::UnauthorizedOperator,
    )]
    pub program: Program<'info, crate::program::Timba>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key())
            @ ErrorCode::UnauthorizedOperator,
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(config: OracleConfig)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&old_oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
        constraint = Oracle::is_valid_fee_percentage(config.fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = Oracle::is_valid_buffer_time(config.oracle_buffer_time) @ ErrorCode::OracleBufferTooSmall,
        constraint = Oracle::is_valid_timeout(config.max_timeout, config.min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = Oracle::is_valid_tickets_count(config.max_tickets) @ ErrorCode::InvalidTicketsCount,
    )]
    pub oracle: Account<'info, Oracle>,

    pub old_oracle_operator: Signer<'info>,
    pub new_oracle_operator: Signer<'info>,
}

// TOKEN MANAGEMENT

#[derive(Accounts)]
#[instruction(config: TokenConfig)]
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
    pub game_vault: UncheckedAccount<'info>,

    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
        associated_token::token_program = token_program,
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
        constraint = is_supported_token_program(&token_program.key()) @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(config: TokenConfig)]
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

#[derive(Accounts)]
pub struct CloseToken<'info> {
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        close = oracle_operator,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
        constraint = game_token.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
        constraint = game_token.fee_amount == 0 @ ErrorCode::TokenFeesOutstanding,
    )]
    pub game_token: Account<'info, GameToken>,

    /// CHECK: PDA authority for the vault ATA, validated by seeds and bump
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
        associated_token::token_program = token_program,
        constraint = game_token_account.amount == 0 @ ErrorCode::TokenVaultNotEmpty,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = is_supported_token_program(&token_program.key()) @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,

    #[account(mut)]
    pub oracle_operator: Signer<'info>,
}

// GAME MANAGEMENT

#[derive(Accounts)]
pub struct GameTokenContext<'info> {
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [GAME_TOKEN_SEED, token_mint.key().as_ref()],
        bump,
        constraint = game_token.token_mint == token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game_token: Account<'info, GameToken>,

    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [GAME_VAULT_SEED, token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
        associated_token::token_program = token_program,
    )]
    pub game_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = is_supported_token_program(&token_program.key()) @ ErrorCode::UnsupportedTokenProgram,
    )]
    pub token_program: Interface<'info, TokenInterface>,

    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> GameTokenContext<'info> {
    pub fn transfer_from_player(
        &self,
        player_token_account: &InterfaceAccount<'info, TokenAccount>,
        player: &Signer<'info>,
        amount: u64,
    ) -> Result<()> {
        self.game_token.transfer_from_player(
            player_token_account.to_account_info(),
            self.game_token_account.to_account_info(),
            player.to_account_info(),
            self.token_program.to_account_info(),
            self.token_mint.to_account_info(),
            amount,
            self.token_mint.decimals,
        )
    }

    pub fn transfer_from_vault(
        &self,
        destination_token_account: &InterfaceAccount<'info, TokenAccount>,
        amount: u64,
    ) -> Result<()> {
        self.game_token.transfer_from_vault(
            self.game_token_account.to_account_info(),
            destination_token_account.to_account_info(),
            self.game_vault.to_account_info(),
            self.token_program.to_account_info(),
            self.token_mint.to_account_info(),
            amount,
            self.token_mint.decimals,
        )
    }
}

#[derive(Accounts)]
#[instruction(config: GameConfig, random_hash: [u8; 32])]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = creator,
        // Base + participants vec prefix + 32 bytes per ticket
        space = GAME_BASE_SIZE
            + 4
            + (config.max_tickets as usize * 32),
        seeds = [GAME_SEED, random_hash.as_ref()],
        bump,
        constraint = game_token_ctx.game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
        constraint = game_token_ctx.game_token.meets_min_amount(config.amount) @ ErrorCode::InvalidAmount,
        constraint = oracle.is_valid_timeout_range(config.timeout) @ ErrorCode::InvalidTimeout,
        constraint = Game::is_valid_tickets_count(config.max_tickets, config.min_tickets, oracle.max_tickets) @ ErrorCode::InvalidTicketsCount,
        constraint = Game::is_valid_game_type_tickets(config.game_type, config.max_tickets, config.min_tickets) @ ErrorCode::InvalidTicketsCount,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    #[account(
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle_operator: Signer<'info>,
    pub game_token_ctx: GameTokenContext<'info>,
    #[account(
        mut,
        associated_token::mint = game_token_ctx.token_mint,
        associated_token::authority = creator,
        associated_token::token_program = game_token_ctx.token_program,
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        constraint = game.is_not_full() @ ErrorCode::GameFull,
        constraint = game.can_join_private(oracle_operator.as_ref(), &oracle.operator) @ ErrorCode::PrivateGameAccessDenied,
        constraint = game.has_sufficient_balance_for_join(player_token_account.amount) @ ErrorCode::InsufficientBalance,
        constraint = game_token_ctx.game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
        constraint = game.token_mint == game_token_ctx.token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub oracle_operator: Option<Signer<'info>>,
    pub game_token_ctx: GameTokenContext<'info>,
    #[account(
        mut,
        associated_token::mint = game_token_ctx.token_mint,
        associated_token::authority = player,
        associated_token::token_program = game_token_ctx.token_program,
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
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
        constraint = game.token_mint == game_token_ctx.token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game: Account<'info, Game>,
    pub game_token_ctx: GameTokenContext<'info>,
    #[account(
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,
    pub oracle_operator: Signer<'info>,
    /// CHECK: Validated against the exact participant at the winner index
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: Game creator for rent refund
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = game_token_ctx.token_mint,
        associated_token::authority = winner,
        associated_token::token_program = game_token_ctx.token_program,
    )]
    pub winner_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.token_mint == game_token_ctx.token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: Player key is validated against the game participants list
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    #[account(
        constraint = game.is_creator(&authority.key())
            || authority.key() == player.key() @ ErrorCode::UnauthorizedPlayer,
    )]
    pub authority: Signer<'info>,
    #[account(seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    pub game_token_ctx: GameTokenContext<'info>,
    #[account(
        mut,
        associated_token::mint = game_token_ctx.token_mint,
        associated_token::authority = player,
        associated_token::token_program = game_token_ctx.token_program,
    )]
    pub player_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseGame<'info> {
    #[account(
        mut,
        close = creator,
        constraint = game.is_creator(&creator.key()) @ ErrorCode::InvalidCreator,
        constraint = game.ticket_amount == 0 || game.tickets_count == 0 @ ErrorCode::GameHasActivePlayers,
        constraint = game.token_mint == game_token_ctx.token_mint.key() @ ErrorCode::InvalidTokenMint,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [ORACLE_SEED], bump)]
    pub oracle: Account<'info, Oracle>,
    pub game_token_ctx: GameTokenContext<'info>,
    #[account(
        mut,
        associated_token::mint = game_token_ctx.token_mint,
        associated_token::authority = creator,
        associated_token::token_program = game_token_ctx.token_program,
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

// FEE MANAGEMENT

#[derive(Accounts)]
pub struct WithdrawTokenFee<'info> {
    pub game_token_ctx: GameTokenContext<'info>,
    #[account(
        seeds = [ORACLE_SEED],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,
    pub oracle_operator: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = game_token_ctx.token_mint,
        associated_token::authority = oracle_operator,
        associated_token::token_program = game_token_ctx.token_program,
    )]
    pub oracle_operator_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}
