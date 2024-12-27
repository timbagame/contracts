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
            8 + // games_won
            8, // games_lost
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
    bot_type: u8,
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
            1 + // bot_type
            4 + bot_seed.len() + // bot_seed
            1 + // bot_auth
            8 + // games_won
            8, // games_lost
        seeds = [b"player_bot", bot_type.to_le_bytes().as_ref(), bot_seed.as_bytes()],
        bump,
    )]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        address = oracle.authority,
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
            8 + // games_counter
            8, // players_counter
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
        constraint = fee_percentage <= 5 @ ErrorCode::InvalidFeePercentage
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority,
    )]
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
        seeds = [b"token", token_mint.key().as_ref()],
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
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(ticker: String, enabled: bool)]
pub struct UpdateToken<'info> {
    #[account(
        mut,
        seeds = [b"token", game_token.token_mint.as_ref()],
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
    creator_key: Pubkey,
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
            8, // fee_amount
        seeds = [b"game", oracle.games_counter.to_le_bytes().as_ref()],
        bump,
        constraint = timeout > 0 @ ErrorCode::InvalidTimeout,
        constraint = min_players <= max_players && match game_type {
            GameType::Coinflip => max_players >= 2 && min_players >= 2,
            GameType::Giveaway => max_players >= 1 && min_players >= 1,
        } @ ErrorCode::InvalidPlayersCount,
    )]
    pub game: Account<'info, Game>,
    #[account(
        address = creator_key,
        constraint = (signer.key() == oracle.authority && creator.bot_auth) ||
                     (signer.key() == creator.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub creator: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"token", token_mint.key().as_ref()],
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
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, player_key: Pubkey)]
pub struct JoinGame<'info> {
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status == GameStatus::Active @ ErrorCode::InvalidGameStatus,
        constraint = Clock::get().unwrap().unix_timestamp < game.created_at + game.timeout @ ErrorCode::TimeoutReached,
        constraint = !game.players.contains(&player_key) @ ErrorCode::AlreadyJoined,
        constraint = game.players.len() < (game.max_players as usize) @ ErrorCode::GameFull,
        constraint = !game.is_private || signer.key() == oracle.authority @ ErrorCode::UnauthorizedPlayer
    )]
    pub game: Account<'info, Game>,
    #[account(
        address = player_key,
        constraint = (signer.key() == oracle.authority && player.bot_auth) ||
                     (signer.key() == player.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"token", game.token_mint.as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount >= game.amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = oracle
    )]
    pub oracle_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
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
#[instruction(game_id: u64)]
pub struct ClaimWin<'info> {
    #[account(
        mut,
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status == GameStatus::ReadyForClaim @ ErrorCode::GameNotReadyForClaim,
        constraint = game.winner == player.key() @ ErrorCode::NotWinner,
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub player: Account<'info, Player>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = oracle
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
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, player_key: Pubkey)]
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
        address = player_key,
        constraint = (signer.key() == oracle.authority && player.bot_auth) ||
                     (signer.key() == player.owner)
                     @ ErrorCode::UnauthorizedPlayer
    )]
    pub player: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}
