use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    fee_percentage: u8,
    oracle_buffer_time: u16,
    max_players: u16,
    max_timeout: u32,
    min_timeout: u32,
)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + // discriminator
            32 + // authority
            1 + // fee_percentage
            2 + // oracle_buffer_time
            2 + // max_players
            4 + // max_timeout
            4, // min_timeout
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    fee_percentage: u8,
    oracle_buffer_time: u16,
    max_players: u16,
    max_timeout: u32,
    min_timeout: u32,
)]
pub struct UpdateOracle<'info> {
    #[account(mut)]
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
            32 + // game_token_account
            32 + // game_vault
            1 + // bump
            8 + // min_amount
            8 + // fee_amount
            1, // enabled
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
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
    pub game_token_account: Account<'info, TokenAccount>,
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
    #[account(mut)]
    pub game_token: Account<'info, GameToken>,
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority @ ErrorCode::UnauthorizedAuthority,
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializePlayerBalance<'info> {
    #[account(
        init,
        payer = player,
        space = 8 + // discriminator
            32 + // player
            32 + // token_mint
            32 + // player_token_account
            8, // amount
        seeds = [b"player_balance", player.key().as_ref(), game_token.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub game_token: Account<'info, GameToken>,
    #[account(
        associated_token::mint = game_token.token_mint,
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
#[instruction(
    game_type: GameType,
    amount: u64,
    max_players: u16,
    min_players: u16,
    timeout: u32,
    is_private: bool,
    random_hash: [u8; 32],
)]
pub struct InitializeGame<'info> {
    #[account(
        init, 
        payer = player, 
        space = 8 + // discriminator
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
            4 + // timeout
            1, // is_private
        seeds = [b"game", random_hash.as_ref()],
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
        constraint = player_balance.player == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = player_balance.token_mint == game_token.token_mint @ ErrorCode::InvalidToken,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(mut)]
    pub oracle: Account<'info, Oracle>,
    #[account(
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        address = player_balance.player_token_account,
        constraint = player_token_account.amount + player_balance.amount >= amount @ ErrorCode::InsufficientBalance,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.game_token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = !game.players.contains(&player_balance.key()) @ ErrorCode::AlreadyJoined,
        constraint = !game.ready_for_oracle(Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
        constraint = game.players.len() < (game.max_players as usize) @ ErrorCode::GameFull,
        constraint = !game.is_private || authority.is_some() && authority.as_ref().unwrap().key() == oracle.authority @ ErrorCode::UnauthorizedPlayer,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    #[account(
        mut,
        constraint = player_balance.token_mint == game.token_mint @ ErrorCode::InvalidToken,
        constraint = player_balance.player == player.key() @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub authority: Option<Signer<'info>>,
    #[account(
        constraint = game_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        address = player_balance.player_token_account,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount + player_balance.amount >= game.amount @ ErrorCode::InsufficientBalance,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.game_token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(
    secret_key: [u8; 32],
)]
pub struct CompleteGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.derive_pda(secret_key) == game.key() @ ErrorCode::WrongSecretKey,
        constraint = game.calculate_winner(secret_key) == player_balance.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = game.ready_for_oracle(Clock::get()?.unix_timestamp) @ ErrorCode::GameNotReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    pub oracle: Account<'info, Oracle>,
    #[account(address = oracle.authority @ ErrorCode::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub player_balance: Account<'info, PlayerBalance>,
    pub game_token: Account<'info, GameToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.players.len() >= 2 && game.players.contains(&player_balance.key()) @ ErrorCode::UnauthorizedPlayer,
        constraint = !game.ready_for_oracle(Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    #[account(
        constraint = game_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        constraint = player_balance.player == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = player_balance.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.game_vault,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        address = player_balance.player_token_account,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.game_token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = match game.game_type {
            GameType::Coinflip => game.players.contains(&player_balance.key()),
            GameType::Giveaway => game.creator == player.key(),
        } @ ErrorCode::UnauthorizedPlayer,
        constraint = game.buffer_passed(oracle.oracle_buffer_time, Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    #[account(
        mut,
        constraint = player_balance.player == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = player_balance.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub oracle: Account<'info, Oracle>,
    #[account(
        constraint = game_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.game_vault,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        address = player_balance.player_token_account,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.game_token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimWin<'info> {
    #[account(
        mut,
        constraint = player_balance.player == player.key() @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub player: Signer<'info>,
    #[account(
        constraint = game_token.token_mint == player_balance.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        address = player_balance.player_token_account,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.game_token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.game_vault,
    )]
    pub game_vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimFee<'info> {
    #[account(mut)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.game_vault,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(mut)]
    pub oracle: Account<'info, Oracle>,
    #[account(address = oracle.authority @ ErrorCode::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = game_token.token_mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.game_token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
