use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    fee_percentage: u8,
    oracle_buffer_time: i64,
    max_players: u16,
    max_timeout: i64,
    min_timeout: i64,
)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + // discriminator
            32 + // authority
            1 + // fee_percentage
            8 + // oracle_buffer_time
            2 + // max_players
            8 + // max_timeout
            8 + // min_timeout
            8 + // games_counter
            8, // players_counter
        seeds = [b"oracle"],
        bump,
        constraint = oracle_buffer_time >= 0 @ ErrorCode::InvalidTimeout
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    fee_percentage: u8,
    oracle_buffer_time: i64,
    max_players: u16,
    max_timeout: i64,
    min_timeout: i64,
)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = oracle_buffer_time >= 0 @ ErrorCode::InvalidTimeout
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority @ ErrorCode::UnauthorizedAuthority,
    )]
    pub old_authority: Signer<'info>,
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(
    ticker: String,
    min_amount: u64,
    enabled: bool,
)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + // discriminator
            4 + ticker.len() + // ticker
            32 + // token_mint
            8 + // min_amount
            1, // enabled
        seeds = [b"token", token_mint.key().as_ref()],
        bump
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", token_mint.key().as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        mut,
        address = oracle.authority @ ErrorCode::UnauthorizedAuthority,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(
    ticker: String,
    min_amount: u64,
    enabled: bool,
)]
pub struct UpdateToken<'info> {
    #[account(
        mut,
        seeds = [b"token", token_mint.key().as_ref()],
        bump
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority @ ErrorCode::UnauthorizedAuthority,
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(
    game_type: GameType,
    amount: u64,
    max_players: u16,
    min_players: u16,
    timeout: i64,
    is_private: bool,
)]
pub struct InitializeGame<'info> {
    #[account(
        init, 
        payer = player, 
        space = 8 + // discriminator
            8 + // id
            32 + // creator
            1 + // game_type
            8 + // amount
            2 + // max_players
            2 + // min_players
            4 + (32 * max_players as usize) + // players vec (4 for vec len + 32 bytes per pubkey)
            32 + // winner
            1 + // status
            32 + // token_mint
            8 + // created_at
            8 + // timeout
            1 + // is_private
            8 + // winner_amount
            8, // fee_amount
        seeds = [b"game", oracle.games_counter.to_le_bytes().as_ref()],
        bump,
        constraint = amount >= game_token.min_amount @ ErrorCode::InvalidAmount,
        constraint = timeout >= oracle.min_timeout @ ErrorCode::InvalidTimeout,
        constraint = timeout <= oracle.max_timeout @ ErrorCode::InvalidTimeout,
        constraint = max_players <= oracle.max_players && min_players <= max_players && match game_type {
            GameType::Coinflip => max_players >= 2 && min_players >= 2,
            GameType::Giveaway => max_players >= 1 && min_players >= 1,
        } @ ErrorCode::InvalidPlayersCount,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"token", token_mint.key().as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player,
        constraint = player_token_account.amount >= amount @ ErrorCode::InsufficientBalance,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", token_mint.key().as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = Clock::get().unwrap().unix_timestamp < game.created_at + game.timeout @ ErrorCode::TimeoutReached,
        constraint = !game.players.contains(&player.key()) @ ErrorCode::AlreadyJoined,
        constraint = game.players.len() < (game.max_players as usize) @ ErrorCode::GameFull,
        constraint = !game.is_private || authority.is_some() && authority.as_ref().unwrap().key() == oracle.authority @ ErrorCode::UnauthorizedPlayer,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    pub authority: Option<Signer<'info>>,
    #[account(
        seeds = [b"token", game.token_mint.as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount >= game.amount @ ErrorCode::InsufficientBalance,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", game.token_mint.as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct SetOracleHash<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.ready_for_oracle() @ ErrorCode::GameNotReadyForOracle
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(address = oracle.authority @ ErrorCode::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", game.token_mint.as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = oracle.authority
    )]
    pub oracle_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct ClaimWin<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::ReadyForClaim @ ErrorCode::GameNotReadyForClaim,
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = game.winner @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player: Signer<'info>,
    pub authority: Option<Signer<'info>>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", game.token_mint.as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = player
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.status != GameStatus::ReadyForClaim @ ErrorCode::GameReadyForClaim,
        constraint = game.status != GameStatus::Completed @ ErrorCode::GameCompleted,
        constraint = game.players.contains(&player.key()) @ ErrorCode::UnauthorizedPlayer,
        constraint = !game.ready_for_oracle() || game.buffer_passed(oracle.oracle_buffer_time) @ ErrorCode::GameReadyForOracle
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    pub authority: Option<Signer<'info>>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = player
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", game.token_mint.as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        constraint = game.status != GameStatus::ReadyForClaim @ ErrorCode::GameReadyForClaim,
        constraint = game.status != GameStatus::Completed @ ErrorCode::GameCompleted,
        constraint = !game.ready_for_oracle() || game.buffer_passed(oracle.oracle_buffer_time) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    #[account(
        address = game.creator @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", game.token_mint.as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
