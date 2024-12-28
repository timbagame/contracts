use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
#[instruction(
    owner_address: Pubkey,
)]
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
    #[account(
        address = owner_address,
    )]
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
            8 + // games_won
            8, // games_lost
        seeds = [b"player_bot", bot_id.to_le_bytes().as_ref(), bot_seed.as_bytes()],
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
    authority_address: Pubkey,
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
    #[account(
        address = authority_address,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    fee_percentage: u8,
    new_authority_address: Pubkey,
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
    #[account(
        address = new_authority_address,
    )]
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_mint_key: Pubkey, ticker: String, enabled: bool)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + // discriminator
            4 + ticker.len() + // ticker
            32 + // token_mint
            1, // enabled
        seeds = [b"token", token_mint.key().as_ref()],
        bump
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        address = token_mint_key,
    )]
    pub token_mint: Account<'info, Mint>,
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
        address = oracle.authority,
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(token_mint_key: Pubkey, ticker: String, enabled: bool)]
pub struct UpdateToken<'info> {
    #[account(
        mut,
        seeds = [b"token", token_mint.key().as_ref()],
        bump
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        address = token_mint_key,
    )]
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = oracle.authority,
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
    player_key: Pubkey,
    token_mint_key: Pubkey,
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
        address = player_key,
        constraint = (signer.key() == oracle.authority && player.bot_auth) ||
                     (signer.key() == player.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub player: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = token_mint_key,
    )]
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"token", token_mint.key().as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = player_vault,
        constraint = player_token_account.amount >= amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"game_vault", token_mint.key().as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
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
        constraint = !game.players.contains(&player.key()) @ ErrorCode::AlreadyJoined,
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
        seeds = [b"player_vault", player.key().as_ref(), game.token_mint.key().as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player_vault,
        constraint = game.game_type != GameType::Coinflip || player_token_account.amount >= game.amount @ ErrorCode::InsufficientVaultBalance
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"game_vault", game.token_mint.key().as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault,
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
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = game.winner,
    )]
    pub player: Account<'info, Player>,
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), game.token_mint.key().as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    #[account(
        seeds = [b"game_vault", game.token_mint.key().as_ref()],
        bump,
    )]
    pub game_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = player_vault
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = game.token_mint,
        associated_token::authority = oracle.authority
    )]
    pub oracle_token_account: Account<'info, TokenAccount>,
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

#[derive(Accounts)]
#[instruction(depositor_address: Pubkey, player_key: Pubkey, token_mint_key: Pubkey, amount: u64)]
pub struct DepositPlayer<'info> {
    #[account(
        address = player_key,
    )]
    pub player: Account<'info, Player>,
    #[account(
        address = token_mint_key,
    )]
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"token", token_mint.key().as_ref()],
        bump,
        constraint = game_token.enabled @ ErrorCode::TokenNotEnabled
    )]
    pub game_token: Account<'info, GameToken>,
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = player_vault,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        address = depositor_address,
    )]
    pub depositor: Signer<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = depositor,
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(receiver_address: Pubkey, player_key: Pubkey, token_mint_key: Pubkey, amount: u64)]
pub struct WithdrawPlayer<'info> {
    #[account(
        address = player_key,
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
    #[account(
        address = token_mint_key,
    )]
    pub token_mint: Account<'info, Mint>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = player_vault,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"player_vault", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub player_vault: AccountInfo<'info>,
    #[account(
        address = receiver_address,
    )]
    pub receiver: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = receiver,
    )]
    pub receiver_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(receiver_key: Pubkey, tipper_key: Pubkey, token_mint_key: Pubkey, amount: u64)]
pub struct TipPlayer<'info> {
    #[account(
        address = tipper_key,
        constraint = (signer.key() == oracle.authority && tipper.bot_auth) ||
                     (signer.key() == tipper.owner)
                     @ ErrorCode::UnauthorizedPlayer,
    )]
    pub tipper: Account<'info, Player>,
    #[account(
        address = receiver_key,
    )]
    pub receiver: Account<'info, Player>,
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"oracle"],
        bump,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        address = token_mint_key,
    )]
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"player_vault", tipper.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub tipper_vault: AccountInfo<'info>,
    #[account(
        seeds = [b"player_vault", receiver.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub receiver_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = tipper_vault,
    )]
    pub tipper_token_account: Account<'info, TokenAccount>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = receiver_vault,
    )]
    pub receiver_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}
