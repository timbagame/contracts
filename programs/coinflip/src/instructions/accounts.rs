use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    treasury: Pubkey,
    fee_percentage: u8,
    operator: Pubkey
)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + // discriminator
            32 + // treasury
            1 + // fee_percentage
            32 + // operator
            8, // game_counter
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
    max_participants: u16,
    min_participants: u16,
    timeout_duration: i64,
    is_private: bool
)]
pub struct InitializeGame<'info> {
    #[account(
        init, 
        payer = creator, 
        space = 8 + // discriminator
            32 + // creator
            1 + // game_type
            8 + // amount
            2 + // max_participants
            2 + // min_participants
            (32 * max_participants as usize) + // participants vec
            33 + // winner Option<Pubkey>
            1 + // status
            32 + // token_mint
            32 + // oracle_hash [u8; 32]
            8 + // created_at
            8 + // timeout_duration
            1, // is_private
        seeds = [b"game", config.game_counter.to_le_bytes().as_ref()],
        bump,
        constraint = timeout_duration > 0 @ ErrorCode::InvalidTimeout,
        constraint = amount <= u64::MAX / (max_participants as u64) @ ErrorCode::InvalidParticipantCount,
        constraint = min_participants <= max_participants && match game_type {
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
        associated_token::mint = token_mint,
        associated_token::authority = creator,
        constraint = creator_token_account.amount >= amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
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
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount >= game.amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", game.token_mint.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct SetOracleHash<'info> {
    #[account(
        mut,
        constraint = !game.has_oracle_hash() @ ErrorCode::OracleHashAlreadySet,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.is_ready_for_oracle() @ ErrorCode::GameNotFull
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(address = config.operator)]
    pub oracle: Signer<'info>,
    pub recent_blockhash: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::ReadyForClaim @ ErrorCode::GameNotReadyForClaim,
        constraint = game.winner.unwrap() == winner.key() @ ErrorCode::NotWinner,
        close = creator
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        address = game.creator
    )]
    pub creator: AccountInfo<'info>,
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub winner: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = winner
    )]
    pub winner_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = config.treasury
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", game.token_mint.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.status != GameStatus::ReadyForClaim @ ErrorCode::GameReadyForClaim,
        constraint = game.status != GameStatus::Completed @ ErrorCode::GameCompleted,
        constraint = game.participants.contains(&participant.key()) @ ErrorCode::InvalidParticipant,
        constraint = !game.is_ready_for_oracle() @ ErrorCode::GameReadyForOracle
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = participant
    )]
    pub participant_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", game.token_mint.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub participant: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        constraint = game.status == GameStatus::Active @ ErrorCode::InvalidGameStatus,
        constraint = Clock::get().unwrap().unix_timestamp >= game.created_at + game.timeout_duration @ ErrorCode::TimeoutNotReached,
        constraint = game.game_type == GameType::Giveaway || game.participants.is_empty() @ ErrorCode::GameNotEmpty,
        close = creator
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        address = game.creator
    )]
    pub creator: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = creator
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"vault", game.token_mint.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
