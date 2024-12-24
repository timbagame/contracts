use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
#[instruction(telegram_id: String)]
pub struct InitializeTelegramUser<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
            4 + telegram_id.len() + // telegram_id (String)
            33 + // Option<Pubkey> (1 byte for option + 32 for pubkey)
            1, // bot_auth
        seeds = [b"telegram_user", telegram_id.as_bytes()],
        bump
    )]
    pub telegram_user: Account<'info, TelegramUser>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = oracle.authority
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
    fee_percentage: u8,
)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
            1 + // fee_percentage
            32 + // authority
            8, // game_counter
        seeds = [b"oracle"],
        bump,
        constraint = fee_percentage <= 5 @ ErrorCode::InvalidFeePercentage
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
)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = oracle.authority == old_authority.key() @ ErrorCode::UnauthorizedOperator,
        constraint = fee_percentage <= 5 @ ErrorCode::InvalidFeePercentage
    )]
    pub oracle: Account<'info, Oracle>,
    pub old_authority: Signer<'info>,
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(ticker: String, enabled: bool)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
            4 + ticker.len() + // ticker (String)
            32 + // token_mint
            1, // enabled
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = game_token,
    )]
    pub token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.authority == authority.key()
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(ticker: String, enabled: bool)]
pub struct UpdateToken<'info> {
    #[account(
        mut,
        seeds = [b"game_token", game_token.token_mint.as_ref()],
        bump
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.authority == authority.key()
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(
    creator_telegram_id: Option<String>,
    telegram_group_id: Option<String>,
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
            (1 + 4 + creator_telegram_id.as_ref().map_or(0, |id| id.len())) + // creator_telegram_id (1 for Option, 4 for String len)
            (1 + 4 + telegram_group_id.as_ref().map_or(0, |id| id.len())) + // telegram_group_id (1 for Option, 4 for String len)
            1 + // game_type
            8 + // amount
            2 + // max_players
            2 + // min_players
            4 + (32 * max_players as usize) + // players vec (4 for vec len + 32 bytes per pubkey)
            2 + // winner
            1 + // status
            32 + // token_mint
            8 + // created_at
            8 + // timeout
            1, // is_private
        seeds = [b"game", oracle.game_counter.to_le_bytes().as_ref()],
        bump,
        constraint = timeout > 0 @ ErrorCode::InvalidTimeout,
        constraint = min_players <= max_players && match game_type {
            GameType::Coinflip => max_players >= 2 && min_players >= 2,
            GameType::Giveaway => max_players >= 1 && min_players >= 1,
        } @ ErrorCode::InvalidPlayersCount,
        constraint = !is_private || telegram_group_id.is_some() @ ErrorCode::InvalidTelegramGroupId
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"telegram_user", creator_telegram_id.unwrap().as_bytes()],
        bump,
        constraint = (signer.key() == oracle.authority && telegram_user.bot_auth) ||
                     (signer.key() == telegram_user.owner.unwrap())
                     @ ErrorCode::UnauthorizedJoin
    )]
    pub telegram_user: Option<Account<'info, TelegramUser>>,
    pub signer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = if let Some(account) = &telegram_user {
            account.key()
        } else {
            signer.key()
        }
    )]
    pub creator: AccountInfo<'info>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = creator,
        constraint = creator_token_account.amount >= amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(
        address = game_token.token_account
    )]
    pub oracle_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, telegram_id: String)]
pub struct JoinGame<'info> {
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status == GameStatus::Active @ ErrorCode::InvalidGameStatus,
        constraint = Clock::get().unwrap().unix_timestamp < game.created_at + game.timeout @ ErrorCode::TimeoutReached,
        constraint = !game.players.contains(&player.key()) @ ErrorCode::AlreadyJoined,
        constraint = game.players.len() < (game.max_players as usize) @ ErrorCode::GameFull,
        constraint = !game.is_private || signer.key() == oracle.authority @ ErrorCode::UnauthorizedJoin
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"telegram_user", telegram_id.as_bytes()],
        bump,
        constraint = (signer.key() == oracle.authority && telegram_user.bot_auth) ||
                     (signer.key() == telegram_user.owner.unwrap())
                     @ ErrorCode::UnauthorizedJoin
    )]
    pub telegram_user: Option<Account<'info, TelegramUser>>,
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"game_token", game.token_mint.as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        address = if let Some(account) = &telegram_user {
            account.key()
        } else {
            signer.key()
        }
    )]
    pub player: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount >= game.amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        address = game_token.token_account
    )]
    pub oracle_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct SetOracleHash<'info> {
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status == GameStatus::Active @ ErrorCode::GameNotActive,
        constraint = game.is_ready_for_oracle() @ ErrorCode::GameNotFull
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(address = oracle.authority)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, telegram_id: String)]
pub struct ClaimWinnings<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status == GameStatus::ReadyForClaim @ ErrorCode::GameNotReadyForClaim,
        constraint = game.get_winner() == player.key() @ ErrorCode::NotWinner,
        close = creator
    )]
    pub game: Account<'info, Game>,
    /// CHECK: Game creator receiving rent refund, verified by address constraint
    #[account(
        address = game.creator
    )]
    pub creator: AccountInfo<'info>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        seeds = [b"telegram_user", telegram_id.as_bytes()],
        bump,
        constraint = (signer.key() == oracle.authority && telegram_user.bot_auth) ||
                     (signer.key() == telegram_user.owner.unwrap())
                     @ ErrorCode::UnauthorizedJoin
    )]
    pub telegram_user: Option<Account<'info, TelegramUser>>,
    pub signer: Signer<'info>,
    #[account(
        address = if let Some(account) = &telegram_user {
            account.key()
        } else {
            signer.key()
        }
    )]
    pub player: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player
    )]
    pub winner_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = oracle.authority
    )]
    pub operator_token_account: Account<'info, TokenAccount>,
    /// CHECK: Vault PDA for token authority, seeds checked in constraints
    #[account(
        seeds = [b"vault", game.token_mint.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, telegram_id: String)]
pub struct UnjoinGame<'info> {
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status != GameStatus::ReadyForClaim @ ErrorCode::GameReadyForClaim,
        constraint = game.status != GameStatus::Completed @ ErrorCode::GameCompleted,
        constraint = game.players.contains(&player.key()) @ ErrorCode::InvalidPlayer,
        constraint = !game.is_ready_for_oracle() @ ErrorCode::GameReadyForOracle
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"telegram_user", telegram_id.as_bytes()],
        bump,
        constraint = (signer.key() == oracle.authority && telegram_user.bot_auth) ||
                     (signer.key() == telegram_user.owner.unwrap())
                     @ ErrorCode::UnauthorizedJoin
    )]
    pub telegram_user: Option<Account<'info, TelegramUser>>,
    pub signer: Signer<'info>,
    #[account(
        address = if let Some(account) = &telegram_user {
            account.key()
        } else {
            signer.key()
        }
    )]
    pub player: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: Vault PDA for token authority, seeds checked in constraints
    #[account(
        seeds = [b"vault", game.token_mint.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status == GameStatus::Active @ ErrorCode::InvalidGameStatus,
        constraint = Clock::get().unwrap().unix_timestamp >= game.created_at + game.timeout @ ErrorCode::TimeoutNotReached,
        constraint = game.game_type == GameType::Giveaway || game.players.is_empty() @ ErrorCode::GameNotEmpty,
        close = creator
    )]
    pub game: Account<'info, Game>,
    #[account(
        address = game.creator
    )]
    pub creator: AccountInfo<'info>,
    #[account(
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
    /// CHECK: Vault PDA for token authority, seeds checked in constraints
    #[account(
        seeds = [b"vault", game.token_mint.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
