use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    treasury: Pubkey,
    fee_percentage: u64,
    operator: Pubkey
)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + 32 + 8 + 32 + 8,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    game_type: GameType,
    amount: u64,
    max_participants: u8,
    min_participants: u8,
    timeout_duration: i64,
    is_private: bool
)]
pub struct InitializeGame<'info> {
    #[account(
        init, 
        payer = creator, 
        space = 8 + 32 + 1 + 8 + 1 + 32 * 10 + 33 + 1 + 32 + 33 + 1 + 8 + 8 + 1 + 64 * 10 + 1,
        seeds = [b"game", config.game_counter.to_le_bytes().as_ref()],
        bump,
        constraint = timeout_duration > 0 @ ErrorCode::InvalidTimeout,
        constraint = amount <= u64::MAX / (max_participants as u64) @ ErrorCode::InvalidParticipantCount,
        constraint = min_participants <= max_participants @ ErrorCode::InvalidParticipantCount,
        constraint = match game_type {
            GameType::Coinflip => max_participants >= 2 && min_participants >= 2,
            GameType::Giveaway => max_participants >= 1 && min_participants >= 1,
        } @ ErrorCode::InvalidParticipantCount
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key(),
        constraint = creator_token_account.mint == token_mint.key()
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault_token_account.mint == token_mint.key()
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: Vault PDA for token authority, seeds are verified in constraints
    #[account(
        mut,
        seeds = [b"vault", game.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::InvalidGameStatus,
        constraint = Clock::get().unwrap().unix_timestamp < game.created_at + game.timeout_duration @ ErrorCode::TimeoutReached,
        constraint = !game.participants.contains(&player.key()) @ ErrorCode::AlreadyJoined,
        constraint = game.participants.len() < (game.max_participants as usize) @ ErrorCode::GameFull
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        constraint = player_token_account.owner == player.key(),
        constraint = player_token_account.mint == game.token_mint @ ErrorCode::InvalidToken
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault_token_account.mint == game.token_mint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Vault PDA for token authority, seeds are verified in constraints
    #[account(
        mut,
        seeds = [b"vault", game.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct SetOracleHash<'info> {
    #[account(
        mut,
        constraint = game.oracle_hash.is_none() @ ErrorCode::OracleHashAlreadySet,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.is_ready_for_oracle() @ ErrorCode::GameNotFull
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(constraint = oracle.key() == config.operator @ ErrorCode::InvalidOperator)]
    pub oracle: Signer<'info>,
    /// CHECK: Used for randomness
    pub recent_blockhash: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::ReadyForClaim @ ErrorCode::GameNotReadyForClaim,
        constraint = game.winner.unwrap() == winner.key() @ ErrorCode::NotWinner
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub winner: Signer<'info>,
    #[account(
        mut,
        constraint = vault_token_account.mint == game.token_mint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = winner_token_account.owner == winner.key(),
        constraint = winner_token_account.mint == game.token_mint
    )]
    pub winner_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_token_account.mint == game.token_mint
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    /// CHECK: Vault PDA for token authority, seeds are verified in constraints
    #[account(
        mut,
        seeds = [b"vault", game.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.status != GameStatus::ReadyForClaim @ ErrorCode::GameReadyForClaim,
        constraint = game.status != GameStatus::Completed @ ErrorCode::GameCompleted,
        constraint = game.participants.contains(&participant.key()) @ ErrorCode::InvalidParticipant,
        constraint = !game.is_ready_for_oracle() 
            || Clock::get().unwrap().unix_timestamp >= game.created_at + game.timeout_duration
            @ ErrorCode::GameFull
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        constraint = vault_token_account.mint == game.token_mint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = participant_token_account.owner == participant.key(),
        constraint = participant_token_account.mint == game.token_mint
    )]
    pub participant_token_account: Account<'info, TokenAccount>,
    /// CHECK: Vault PDA for token authority, seeds are verified in constraints
    #[account(
        mut,
        seeds = [b"vault", game.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub participant: Signer<'info>,
}
