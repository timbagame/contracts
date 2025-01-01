use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializePlayer<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
            8 + // id
            32 + // owner
            1 + // is_bot
            1 + // bot_id
            4 + // bot_seed (String prefix)
            1 + // bot_auth
            8, // games_won
        seeds = [b"player", owner.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    bot_id: u8,
    bot_seed: String,
)]
pub struct InitializePlayerBot<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
            8 + // id
            32 + // owner
            1 + // is_bot
            1 + // bot_id
            4 + bot_seed.len() + // bot_seed
            1 + // bot_auth
            8, // games_won
        seeds = [b"player_bot", bot_id.to_le_bytes().as_ref(), bot_seed.as_bytes()],
        bump,
    )]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = oracle.authority @ ErrorCode::UnauthorizedOracle,
    )]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    owner: Pubkey,
    bot_auth: bool,
    bot_id: u8,
    bot_seed: String,
)]
pub struct UpdatePlayerBot<'info> {
    #[account(
        mut,
        seeds = [b"player_bot", bot_id.to_le_bytes().as_ref(), bot_seed.as_bytes()],
        bump,
        constraint = player.bot_auth && signer.key() == oracle.authority || signer.key() == player.owner @ ErrorCode::UnauthorizedPlayer
    )]
    pub player: Account<'info, Player>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub signer: Signer<'info>,
}

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
        payer = payer,
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
        constraint = fee_percentage <= 5 @ ErrorCode::InvalidFeePercentage,
        constraint = oracle_buffer_time >= 0 @ ErrorCode::InvalidTimeout
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
        constraint = fee_percentage <= 5 @ ErrorCode::InvalidFeePercentage,
        constraint = oracle_buffer_time >= 0 @ ErrorCode::InvalidTimeout
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority @ ErrorCode::UnauthorizedOracle,
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
        payer = payer,
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
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority @ ErrorCode::UnauthorizedOracle,
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
        address = oracle.authority @ ErrorCode::UnauthorizedOracle,
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
        payer = payer, 
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
    #[account(
        constraint = (signer.key() == oracle.authority && creator.bot_auth) ||
                     (signer.key() == creator.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub creator: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
        associated_token::authority = creator_vault,
        constraint = creator_token_account.amount >= amount @ ErrorCode::InsufficientBalance,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
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
    /// CHECK: This is a PDA that serves as the authority for the player's token accounts
    #[account(
        seeds = [b"player_vault", creator.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub creator_vault: AccountInfo<'info>,
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
        constraint = !game.is_private || authority.key() == oracle.authority @ ErrorCode::UnauthorizedPlayer,
    )]
    pub game: Account<'info, Game>,
    #[account(
        constraint = (authority.key() == oracle.authority && player.bot_auth) ||
                     (owner.key() == player.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player: Account<'info, Player>,
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token", game.token_mint.as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: This is a PDA that serves as the authority for the player's token accounts
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = player_vault,
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
        constraint = game.ready_for_oracle() @ ErrorCode::GameNotFull
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(address = oracle.authority @ ErrorCode::UnauthorizedOracle)]
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
        mut,
        address = game.winner @ ErrorCode::UnauthorizedPlayer,
        constraint = (signer.key() == oracle.authority && winner.bot_auth) ||
                     (signer.key() == winner.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub winner: Account<'info, Player>,
    pub signer: Signer<'info>,
    /// CHECK: This is a PDA that serves as the authority for the winner's token accounts
    #[account(
        seeds = [b"player_vault", winner.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub winner_vault: AccountInfo<'info>,
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
        associated_token::authority = winner_vault
    )]
    pub winner_token_account: Account<'info, TokenAccount>,
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
    #[account(
        constraint = (signer.key() == oracle.authority && player.bot_auth) ||
                     (signer.key() == player.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player: Account<'info, Player>,
    pub signer: Signer<'info>,
    /// CHECK: This is a PDA that serves as the authority for the player's token accounts
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player_vault
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the game's token accounts
    #[account(
        seeds = [b"game_vault", game.token_mint.as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
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
#[instruction(
    amount: u64,
)]
pub struct DepositPlayer<'info> {
    #[account(
        constraint = amount > 0 @ ErrorCode::InvalidAmount,
    )]
    pub player: Account<'info, Player>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"token", token_mint.key().as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled
    )]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: This is a PDA that serves as the authority for the player's token accounts
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), game_token.token_mint.as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = game_token.token_mint,
        associated_token::authority = player_vault,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    pub depositor: Signer<'info>,
    #[account(
        associated_token::mint = game_token.token_mint,
        associated_token::authority = depositor,
        constraint = depositor_token_account.amount >= amount @ ErrorCode::InsufficientBalance
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(
    amount: u64,
)]
pub struct WithdrawPlayer<'info> {
    #[account(
        constraint = amount > 0 @ ErrorCode::InvalidAmount,
        constraint = (signer.key() == oracle.authority && player.bot_auth) ||
                     (signer.key() == player.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = player_vault,
        constraint = player_token_account.amount >= amount @ ErrorCode::InsufficientBalance
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA that serves as the authority for the player's token accounts
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    /// CHECK: This is the receiver's account that will receive the tokens
    pub receiver: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = receiver,
    )]
    pub receiver_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(
    amount: u64,
)]
pub struct TipPlayer<'info> {
    #[account(
        constraint = amount > 0 @ ErrorCode::InvalidAmount,
        constraint = (signer.key() == oracle.authority && tipper.bot_auth) ||
                     (signer.key() == tipper.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub tipper: Account<'info, Player>,
    pub receiver: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    /// CHECK: This is a PDA that serves as the authority for the tipper's token accounts
    #[account(
        seeds = [b"player_vault", tipper.key().as_ref(), game_token.token_mint.as_ref()],
        bump,
    )]
    pub tipper_vault: AccountInfo<'info>,
    /// CHECK: This is a PDA that serves as the authority for the receiver's token accounts
    #[account(
        seeds = [b"player_vault", receiver.key().as_ref(), game_token.token_mint.as_ref()],
        bump,
    )]
    pub receiver_vault: AccountInfo<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"token", token_mint.key().as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        associated_token::mint = game_token.token_mint,
        associated_token::authority = tipper_vault,
        constraint = tipper_token_account.amount >= amount @ ErrorCode::InsufficientBalance
    )]
    pub tipper_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game_token.token_mint,
        associated_token::authority = receiver_vault,
    )]
    pub receiver_token_account: Account<'info, TokenAccount>,
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
        constraint = !game.ready_for_oracle() || game.buffer_passed(oracle.oracle_buffer_time) @ ErrorCode::GameReadyForOracle
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    /// CHECK: This is a PDA that serves as the authority for the creator's token accounts
    #[account(
        seeds = [b"player_vault", game.creator.as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub creator_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = creator_vault,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
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
