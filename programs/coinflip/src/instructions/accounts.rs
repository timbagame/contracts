use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

// Oracle Management
// ----------------

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u16, max_players: u16, max_timeout: u32, min_timeout: u32)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = authority,
        space = ORACLE_SIZE,
        seeds = [b"oracle"],
        bump,
        constraint = Oracle::is_valid_fee_percentage(&Oracle::default(), fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = Oracle::is_valid_timeout(&Oracle::default(), max_timeout, min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = Oracle::is_valid_players_count(&Oracle::default(), max_players) @ ErrorCode::InvalidPlayersCount,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u16, max_players: u16, max_timeout: u32, min_timeout: u32)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_authority(&old_authority.key()) @ ErrorCode::UnauthorizedAuthority,
        constraint = oracle.is_valid_fee_percentage(fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = oracle.is_valid_timeout(max_timeout, min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = oracle.is_valid_players_count(max_players) @ ErrorCode::InvalidPlayersCount,
    )]
    pub oracle: Account<'info, Oracle>,
    pub old_authority: Signer<'info>,
    pub new_authority: Signer<'info>,
}

// Token Management
// ---------------

#[derive(Accounts)]
#[instruction(min_amount: u64, enabled: bool)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        space = GAME_TOKEN_SIZE,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_authority(&authority.key()) @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(min_amount: u64, enabled: bool)]
pub struct UpdateToken<'info> {
    #[account(
        mut,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_authority(&authority.key()) @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
}

// Player Management
// ----------------

#[derive(Accounts)]
pub struct InitializePlayerBalance<'info> {
    #[account(
        init,
        payer = player,
        space = PLAYER_BALANCE_SIZE,
        seeds = [b"player_balance", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(
        mut,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        associated_token::mint = token_mint,
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
pub struct WithdrawPlayerBalance<'info> {
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
        constraint = player_balance.is_owner(&player.key()) @ ErrorCode::UnauthorizedPlayer,
        constraint = player_balance.is_token_mint(&token_mint.key()) @ ErrorCode::InvalidAmount,
        constraint = player_balance.has_sufficient_balance() @ ErrorCode::InsufficientBalance,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub player: Signer<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(seeds = [b"game_token", token_mint.key().as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// Game Management
// --------------

#[derive(Accounts)]
#[instruction(game_type: GameType, amount: u64, max_players: u16, min_players: u16, timeout: u32, is_private: bool, random_hash: [u8; 32])]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = player,
        space = GAME_SIZE,
        seeds = [b"game", random_hash.as_ref()],
        bump,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
        constraint = game_token.meets_min_amount(amount) @ ErrorCode::InvalidAmount,
        constraint = oracle.is_valid_timeout_range(timeout) @ ErrorCode::InvalidTimeout,
        constraint = Game::is_valid_players_count(max_players, min_players, oracle.max_players) @ ErrorCode::InvalidPlayersCount,
        constraint = Game::is_valid_game_type_players(game_type, max_players, min_players) @ ErrorCode::InvalidPlayersCount,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(mut, seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: Account<'info, Mint>,
    #[account(seeds = [b"game_token", token_mint.key().as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        constraint = game.is_not_full() @ ErrorCode::GameFull,
        constraint = !game.ready_for_oracle(Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
        constraint = game.can_join_private(authority.as_ref(), &oracle.authority) @ ErrorCode::UnauthorizedPlayer,
        constraint = game.has_sufficient_balance_for_join(player_token_account.amount, player_balance.amount) @ ErrorCode::InsufficientBalance,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
    )]
    pub game: Account<'info, Game>,
    #[account(
        init,
        payer = player,
        space = PLAYER_PARTICIPATION_SIZE,
        seeds = [b"player_participation", game.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub player_participation: Account<'info, PlayerParticipation>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub authority: Option<Signer<'info>>,
    #[account(seeds = [b"game_token", game.token_mint.as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", game.token_mint.as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = game.token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    #[account(seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(secret_key: [u8; 32])]
pub struct CompleteGame<'info> {
    #[account(
        mut,
        close = creator,
        constraint = game.is_creator(&creator.key()) @ ErrorCode::InvalidCreator,
        constraint = game.derive_pda(secret_key) == game.key() @ ErrorCode::InvalidSecretKey,
        constraint = game.calculate_winner_index(secret_key) == player_participation.player_index @ ErrorCode::UnauthorizedPlayer,
        constraint = game.ready_for_oracle(Clock::get()?.unix_timestamp) @ ErrorCode::GameNotReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_authority(&authority.key()) @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        close = player,
        seeds = [b"player_participation", game.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub player_participation: Account<'info, PlayerParticipation>,
    /// CHECK: Validated by game's winner calculation
    #[account(mut)]
    pub player: AccountInfo<'info>,
    /// CHECK: Game creator for rent refund
    #[account(mut)]
    pub creator: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(seeds = [b"game_token", game.token_mint.as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.is_cancellable_by(&authority.key(), &oracle.authority) @ ErrorCode::UnauthorizedAuthority,
        constraint = game.is_within_cancellation_window(oracle.oracle_buffer_time, Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    #[account(
        mut,
        close = player,
        seeds = [b"player_participation", game.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub player_participation: Account<'info, PlayerParticipation>,
    /// CHECK: Player account - validated by constraints
    #[account(mut)]
    pub player: AccountInfo<'info>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        close = creator,
        constraint = game.is_creator(&creator.key()) @ ErrorCode::InvalidCreator,
        constraint = game.is_cancellable_by(&authority.key(), &oracle.authority) @ ErrorCode::UnauthorizedAuthority,
        constraint = game.has_no_active_participants() @ ErrorCode::CoinflipHasActivePlayers,
        constraint = game.is_within_cancellation_window(oracle.oracle_buffer_time, Clock::get()?.unix_timestamp) @ ErrorCode::GameReadyForOracle,
    )]
    pub game: Account<'info, Game>,
    /// CHECK: Game creator for rent refund - validated by constraints
    #[account(mut)]
    pub creator: AccountInfo<'info>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", creator.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub creator_balance: Account<'info, PlayerBalance>,
    #[account(seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CleanupPlayerParticipation<'info> {
    /// CHECK: Game account that has been completed (closed)
    #[account(
        constraint = game.data_is_empty() @ ErrorCode::GameNotCompleted,
    )]
    pub game: AccountInfo<'info>,
    #[account(
        mut,
        close = player,
        seeds = [b"player_participation", game.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub player_participation: Account<'info, PlayerParticipation>,
    /// CHECK: Player account for rent refund
    #[account(mut)]
    pub player: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

// Fee Management
// -------------

#[derive(Accounts)]
pub struct WithdrawTokenFee<'info> {
    #[account(
        mut,
        seeds = [b"game_token", token_mint.key().as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub token_mint: Account<'info, Mint>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_authority(&authority.key()) @ ErrorCode::UnauthorizedAuthority,
    )]
    pub oracle: Account<'info, Oracle>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = game_vault,
    )]
    pub game_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
