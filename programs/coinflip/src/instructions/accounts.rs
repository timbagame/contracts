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
    max_timeout: u16,
    min_timeout: u16,
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
            2 + // max_timeout
            2 + // min_timeout
            4, // games_counter
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
    max_timeout: u16,
    min_timeout: u16,
)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
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
            32 + // token_account
            32 + // vault
            1 + // bump
            8 + // min_amount
            8 + // fee_amount
            1, // enabled
        seeds = [b"token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"vault", token_mint.key().as_ref()],
        bump,
    )]
    pub vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = vault,
    )]
    pub token_account: Account<'info, TokenAccount>,
    #[account()]
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
pub struct InitializePlayerToken<'info> {
    #[account(
        init,
        payer = player,
        space = 8 + // discriminator
            32 + // player
            32 + // token_mint
            32 + // token_account
            8, // amount
        seeds = [b"player_token", player.key().as_ref(), game_token.token_mint.as_ref()],
        bump,
    )]
    pub player_token: Account<'info, PlayerToken>,
    pub game_token: Account<'info, GameToken>,
    #[account(
        associated_token::mint = game_token.token_mint,
        associated_token::authority = player,
    )]
    pub token_account: Account<'info, TokenAccount>,
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
    timeout: u16,
    is_private: bool,
)]
pub struct InitializeGame<'info> {
    #[account(
        init, 
        payer = player, 
        space = 8 + // discriminator
            4 + // id
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
            2 + // timeout
            1, // is_private
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
        constraint = player_token.player == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = player_token.token_mint == game_token.token_mint @ ErrorCode::InvalidToken,
    )]
    pub player_token: Account<'info, PlayerToken>,
    #[account(mut)]
    pub oracle: Account<'info, Oracle>,
    #[account(
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        address = player_token.token_account,
        constraint = player_token_account.amount + player_token.amount >= amount @ ErrorCode::InsufficientBalance,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.token_account,
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
        constraint = !game.players.contains(&player.key()) @ ErrorCode::AlreadyJoined,
        constraint = game.players.len() < (game.max_players as usize) @ ErrorCode::GameFull,
        constraint = !game.is_private || authority.is_some() && authority.as_ref().unwrap().key() == oracle.authority @ ErrorCode::UnauthorizedPlayer,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    #[account(
        mut,
        constraint = player_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
        constraint = player_token.player == player.key() @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player_token: Account<'info, PlayerToken>,
    pub authority: Option<Signer<'info>>,
    #[account(
        constraint = game_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        associated_token::mint = game_token.token_mint,
        associated_token::authority = player,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount + player_token.amount >= game.amount @ ErrorCode::InsufficientBalance,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(
    random_number: u64,
)]
pub struct SetOracleHash<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
    )]
    pub game: Account<'info, Game>,
    #[account()]
    pub oracle: Account<'info, Oracle>,
    #[account(address = oracle.authority @ ErrorCode::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
    #[account(
        constraint = game_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    #[account(
        seeds = [b"player_token", game.calculate_winner(random_number as usize, Clock::get()?.unix_timestamp as u64).as_ref(), game_token.token_mint.as_ref()],
        bump,
    )]
    pub player_token: Account<'info, PlayerToken>,
    pub game_token: Account<'info, GameToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.creator != player.key() && game.players.contains(&player.key()) @ ErrorCode::UnauthorizedPlayer,
        constraint = !game.ready_for_oracle(Clock::get()?.unix_timestamp as u64) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    pub player: Signer<'info>,
    #[account(
        constraint = game_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        constraint = player_token.player == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = player_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub player_token: Account<'info, PlayerToken>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.vault,
    )]
    pub vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game_token.token_mint,
        associated_token::authority = player
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account()]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.creator == player.key() || (game.players.contains(&player.key()) && game.game_type != GameType::Giveaway) @ ErrorCode::UnauthorizedPlayer,
        constraint = game.buffer_passed(oracle.oracle_buffer_time, Clock::get()?.unix_timestamp as u64) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    #[account()]
    pub player: Signer<'info>,
    #[account(
        mut,
        constraint = player_token.player == player.key() @ ErrorCode::UnauthorizedPlayer,
        constraint = player_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub player_token: Account<'info, PlayerToken>,
    #[account()]
    pub oracle: Account<'info, Oracle>,
    #[account(
        constraint = game_token.token_mint == game.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.vault,
    )]
    pub vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game_token.token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimWin<'info> {
    #[account(
        mut,
        constraint = player_token.player == player.key() @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player_token: Account<'info, PlayerToken>,
    pub player: Signer<'info>,
    #[account(
        constraint = game_token.token_mint == player_token.token_mint @ ErrorCode::InvalidToken,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        address = player_token.token_account,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = game_token.token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.vault,
    )]
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimFee<'info> {
    #[account(mut)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        address = game_token.vault,
    )]
    pub vault: AccountInfo<'info>,
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
        address = game_token.token_account,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
