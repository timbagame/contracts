use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    owner: Pubkey,
    bot_type: u8,
    bot_seed: String,
    bot_auth: bool,
)]
pub struct InitializePlayer<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
            8 + // id
            32 + // owner
            8 + // games_won
            8 + // games_lost
            1 + // bot_type
            32 + // bot_seed
            1, // bot_auth
        seeds = [b"player", oracle.players_counter.to_le_bytes().as_ref()],
        bump,
        constraint = owner == signer.key() || owner == Pubkey::default() @ ErrorCode::UnauthorizedOwner,
        constraint = oracle.authority == signer.key() || bot_type == 0u8 && bot_seed.is_empty() && !bot_auth @ ErrorCode::UnauthorizedOracle
    )]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    player_id: u64,
    bot_type: u8,
    bot_seed: String,
)]
pub struct InitializePlayerBot<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
                8, // player_id
        seeds = [b"player_bot", bot_type.to_le_bytes().as_ref(), bot_seed.as_bytes()],
        bump,
    )]
    pub player_bot: Account<'info, PlayerBot>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority
    )]
    pub authority: Signer<'info>,
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
        constraint = oracle.authority == old_authority.key() @ ErrorCode::UnauthorizedOracle,
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
            8 + // creator
            1 + // game_type
            8 + // amount
            2 + // max_players
            2 + // min_players
            4 + (32 * max_players as usize) + // players vec (4 for vec len + 32 bytes per pubkey)
            8 + // winner
            1 + // status
            32 + // token_mint
            8 + // created_at
            8 + // timeout
            1, // is_private
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
        constraint = (signer.key() == oracle.authority && creator.bot_auth) ||
                     (signer.key() == creator.owner)
                     @ ErrorCode::UnauthorizedCreator,
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
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, telegram_id: String)]
pub struct JoinGame<'info> {
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status == GameStatus::Active @ ErrorCode::InvalidGameStatus,
        constraint = Clock::get().unwrap().unix_timestamp < game.created_at + game.timeout @ ErrorCode::TimeoutReached,
        constraint = !game.players.contains(&player.id) @ ErrorCode::AlreadyJoined,
        constraint = game.players.len() < (game.max_players as usize) @ ErrorCode::GameFull,
        constraint = !game.is_private || signer.key() == oracle.authority @ ErrorCode::UnauthorizedJoin
    )]
    pub game: Account<'info, Game>,
    #[account(
        constraint = (signer.key() == oracle.authority && player.bot_auth) ||
                     (signer.key() == player.owner)
                     @ ErrorCode::UnauthorizedCreator,
    )]
    pub player: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"game_token", game.token_mint.as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount >= game.amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub player_token_account: Account<'info, TokenAccount>,
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
        constraint = game.winner == player.id @ ErrorCode::NotWinner,
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
#[instruction(game_id: u64, telegram_id: String)]
pub struct UnjoinGame<'info> {
    #[account(
        seeds = [b"game", game_id.to_le_bytes().as_ref()],
        bump,
        constraint = game.status != GameStatus::ReadyForClaim @ ErrorCode::GameReadyForClaim,
        constraint = game.status != GameStatus::Completed @ ErrorCode::GameCompleted,
        constraint = game.players.contains(&player.id) @ ErrorCode::InvalidPlayer,
        constraint = !game.is_ready_for_oracle() @ ErrorCode::GameReadyForOracle
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"telegram_user", telegram_id.as_bytes()],
        bump,
        constraint = (signer.key() == oracle.authority && player.bot_auth) ||
                     (signer.key() == player.owner)
                     @ ErrorCode::UnauthorizedJoin
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
