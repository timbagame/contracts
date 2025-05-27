use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

// Oracle Management
// ----------------

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u16, max_players: u16, max_timeout: u32, min_timeout: u32)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = authority,
        space = ORACLE_SIZE,
        seeds = [b"oracle"],
        bump,
        constraint = fee_percentage <= 100 @ ErrorCode::InvalidAmount,
        constraint = max_timeout >= min_timeout @ ErrorCode::InvalidTimeout,
        constraint = max_players > 0 @ ErrorCode::InvalidPlayersCount,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u16, max_players: u16, max_timeout: u32, min_timeout: u32)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = old_authority.key() == oracle.authority @ ErrorCode::UnauthorizedAuthority,
        constraint = fee_percentage <= 100 @ ErrorCode::InvalidAmount,
        constraint = max_timeout >= min_timeout @ ErrorCode::InvalidTimeout,
        constraint = max_players > 0 @ ErrorCode::InvalidPlayersCount,
    )]
    pub oracle: Account<'info, Oracle>,
    pub old_authority: Signer<'info>,
    pub new_authority: Signer<'info>,
}

// Token Management
// ---------------

#[derive(Accounts)]
#[instruction(min_amount: u64, enabled: bool)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        space = GAME_TOKEN_SIZE,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.authority == authority.key() @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(min_amount: u64, enabled: bool)]
pub struct UpdateToken<'info> {
    #[account(
        mut,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.authority == authority.key() @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
}

// Player Management
// ----------------

#[derive(Accounts)]
pub struct InitializePlayerBalance<'info> {
    #[account(
        init,
        payer = player,
        space = PLAYER_BALANCE_SIZE,
        seeds = [b"player_balance", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(
        mut,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawPlayerBalance<'info> {
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
        constraint = player_balance.player == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = player_balance.token_mint == token_mint.key() @ ErrorCode::InvalidAmount,
        constraint = player_balance.amount > 0 @ ErrorCode::InsufficientBalance,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub player: Signer<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(seeds = [b"game_token", token_mint.key().as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// Game Management
// --------------

#[derive(Accounts)]
#[instruction(game_type: GameType, amount: u64, max_players: u16, min_players: u16, timeout: u32, is_private: bool, random_hash: [u8; 32])]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = player,
        space = Game::space(max_players),
        seeds = [b"game", random_hash.as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled,
        constraint = amount >= game_token.min_amount @ ErrorCode::InvalidAmount,
        constraint = timeout >= oracle.min_timeout && timeout <= oracle.max_timeout @ ErrorCode::InvalidTimeout,
        constraint = max_players <= oracle.max_players && min_players <= max_players @ ErrorCode::InvalidPlayersCount,
        constraint = match game_type {
            GameType::Coinflip => max_players >= 2 && min_players >= 2,
            GameType::Giveaway => max_players >= 1 && min_players >= 1,
        } @ ErrorCode::InvalidPlayersCount,
        constraint = player_token_account.amount + player_balance.amount >= amount @ ErrorCode::InsufficientBalance,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(mut, seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: Account<'info, Mint>,
    #[account(seeds = [b"game_token", token_mint.key().as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        constraint = game.players.len() < (game.max_players as usize) @ ErrorCode::GameFull,
        constraint = !game.players.contains(&player.key()) @ ErrorCode::AlreadyJoined,
        constraint = !game.ready_for_oracle(Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
        constraint = !game.is_private || authority.as_ref().map_or(false, |auth| auth.key() == oracle.authority) @ ErrorCode::UnauthorizedPlayer,
        constraint = game.game_type == GameType::Giveaway || player_token_account.amount + player_balance.amount >= game.amount @ ErrorCode::InsufficientBalance,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub authority: Option<Signer<'info>>,
    #[account(seeds = [b"game_token", game.token_mint.as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", game.token_mint.as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(secret_key: [u8; 64])]
pub struct CompleteGame<'info> {
    #[account(
        mut,
        close = creator,
        constraint = game.creator == creator.key() @ ErrorCode::InvalidCreator,
        constraint = game.derive_pda(secret_key) == game.key() @ ErrorCode::InvalidSecretKey,
        constraint = game.calculate_winner(secret_key) == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = game.ready_for_oracle(Clock::get()?.unix_timestamp) @ ErrorCode::GameNotReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.authority == authority.key() @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
    /// CHECK: Validated by game's winner calculation
    pub player: AccountInfo<'info>,
    /// CHECK: Game creator for rent refund
    #[account(mut)]
    pub creator: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(seeds = [b"game_token", game.token_mint.as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.players.contains(&player.key()) @ ErrorCode::UnauthorizedPlayer,
        constraint = authority.as_ref().map_or(true, |auth| auth.key() == oracle.authority) @ ErrorCode::UnauthorizedAuthority,
        constraint = authority.is_some() || !game.ready_for_oracle(Clock::get()?.unix_timestamp) || game.buffer_passed(oracle.oracle_buffer_time, Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    pub authority: Option<Signer<'info>>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        close = creator,
        constraint = game.creator == creator.key() @ ErrorCode::InvalidCreator,
        constraint = game.players.is_empty() || game.buffer_passed(oracle.oracle_buffer_time, Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", creator.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

// Fee Management
// -------------

#[derive(Accounts)]
pub struct WithdrawTokenFee<'info> {
    #[account(
        mut,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = oracle.authority == authority.key() @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
