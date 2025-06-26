use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

// =============================================================================
// ORACLE MANAGEMENT
// =============================================================================

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u16, max_players: u32, max_timeout: u32, min_timeout: u32)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = oracle_operator,
        space = ORACLE_SIZE,
        seeds = [b"oracle"],
        bump,
        constraint = Oracle::default().is_valid_fee_percentage(fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = Oracle::default().is_valid_timeout(max_timeout, min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = Oracle::default().is_valid_players_count(max_players) @ ErrorCode::InvalidPlayersCount,
    )]
    pub oracle: Account<'info, Oracle>,

    #[account(mut)]
    pub oracle_operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(fee_percentage: u8, oracle_buffer_time: u16, max_players: u32, max_timeout: u32, min_timeout: u32)]
pub struct UpdateOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_operator(&old_oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
        constraint = Oracle::default().is_valid_fee_percentage(fee_percentage) @ ErrorCode::InvalidAmount,
        constraint = Oracle::default().is_valid_timeout(max_timeout, min_timeout) @ ErrorCode::InvalidTimeout,
        constraint = Oracle::default().is_valid_players_count(max_players) @ ErrorCode::InvalidPlayersCount,
    )]
    pub oracle: Account<'info, Oracle>,

    pub old_oracle_operator: Signer<'info>,
    pub new_oracle_operator: Signer<'info>,
}

// =============================================================================
// TOKEN MANAGEMENT
// =============================================================================

#[derive(Accounts)]
#[instruction(min_amount: u64, enabled: bool)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = oracle_operator,
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
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,

    #[account(mut)]
    pub oracle_operator: Signer<'info>,

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
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,

    pub oracle_operator: Signer<'info>,
}

// =============================================================================
// PLAYER MANAGEMENT
// =============================================================================

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
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// =============================================================================
// GAME MANAGEMENT
// =============================================================================

#[derive(Accounts)]
#[instruction(game_type: GameType, amount: u64, max_players: u32, min_players: u32, timeout: u32, is_private: bool, random_hash: [u8; 32])]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = creator,
        space = Game::calculate_storage_size(max_players),
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
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", creator.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub creator_balance: Account<'info, PlayerBalance>,
    #[account(mut, seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub token_mint: Account<'info, Mint>,
    #[account(seeds = [b"game_token", token_mint.key().as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
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
        constraint = game.can_join_private(oracle_operator.as_ref(), &oracle.operator) @ ErrorCode::PrivateGameAccessDenied,
        constraint = game.has_sufficient_balance_for_join(player_token_account.amount, player_balance.amount) @ ErrorCode::InsufficientBalance,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
    )]
    pub game: Account<'info, Game>,
    // No more player_participation account - using merkle trees!
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub oracle_operator: Option<Signer<'info>>,
    #[account(seeds = [b"game_token", game.token_mint.as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", game.token_mint.as_ref()], bump = game_token.vault_bump)]
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
#[instruction(
    random_hash: [u8; 32],
    secret_key: [u8; 32],
    winner_participation: ParticipationEntry,
    winner_merkle_proof: Vec<[u8; 32]>,
)]
pub struct CompleteGame<'info> {
    #[account(
        mut,
        seeds = [b"game", random_hash.as_ref()],
        bump,
        constraint = game.is_creator(&creator.key()) @ ErrorCode::InvalidCreator,
        constraint = Game::verify_secret_key(random_hash, secret_key) @ ErrorCode::InvalidSecretKey,
        constraint = game.total_amount > 0 @ ErrorCode::GameAlreadyCompleted,
    )]
    pub game: Account<'info, Game>,
    #[account(
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,
    pub oracle_operator: Signer<'info>,
    // No more winner_participation account - winner verified via merkle proof
    /// CHECK: Validated by merkle proof verification
    #[account(mut)]
    pub winner: AccountInfo<'info>,
    /// CHECK: Game creator for rent refund
    #[account(mut)]
    pub creator: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", winner.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub winner_balance: Account<'info, PlayerBalance>,
    #[account(
        mut,
        seeds = [b"game_token", game.token_mint.as_ref()],
        bump,
    )]
    pub game_token: Account<'info, GameToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(player_index: u32, exclusion_proof: Option<ExclusionProof>)]
pub struct UnjoinGame<'info> {
    #[account(
        mut,
        constraint = game.game_type != GameType::Snowball && game.game_type != GameType::Dumbball @ ErrorCode::SnowballUnjoinNotAllowed,
    )]
    pub game: Account<'info, Game>,
    // No more PlayerParticipation accounts - using merkle trees!
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    // Last player management handled via merkle tree reconstruction
    #[account(seeds = [b"oracle"], bump)]
    pub oracle: Account<'info, Oracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseGame<'info> {
    #[account(
        mut,
        close = creator,
        constraint = game.is_creator(&creator.key()) @ ErrorCode::InvalidCreator,
        constraint = game.players_count == 0 @ ErrorCode::GameHasActivePlayers,
    )]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
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
pub struct RollGame<'info> {
    #[account(
        mut,
        constraint = game.is_not_full() @ ErrorCode::GameFull,
        constraint = game.can_join_private(oracle_operator.as_ref(), &oracle.operator) @ ErrorCode::PrivateGameAccessDenied,
        constraint = game.has_sufficient_balance_for_join(player_token_account.amount, player_balance.amount) @ ErrorCode::InsufficientBalance,
        constraint = game_token.is_enabled() @ ErrorCode::TokenNotEnabled,
        constraint = game.game_type == GameType::Snowball || game.game_type == GameType::Dumbflip || game.game_type == GameType::Dumbball || game.game_type == GameType::Dumbaway @ ErrorCode::InvalidGameType,
    )]
    pub game: Account<'info, Game>,
    // No more PlayerParticipation accounts - using merkle trees!
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"player_balance", player.key().as_ref(), game.token_mint.as_ref()],
        bump,
    )]
    pub player_balance: Account<'info, PlayerBalance>,
    pub oracle_operator: Option<Signer<'info>>,
    #[account(seeds = [b"game_token", game.token_mint.as_ref()], bump)]
    pub game_token: Account<'info, GameToken>,
    /// CHECK: PDA authority for game's token accounts
    #[account(seeds = [b"game_vault", game.token_mint.as_ref()], bump = game_token.vault_bump)]
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

// =============================================================================
// FEE MANAGEMENT
// =============================================================================

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
    #[account(seeds = [b"game_vault", token_mint.key().as_ref()], bump = game_token.vault_bump)]
    pub game_vault: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"oracle"],
        bump,
        constraint = oracle.is_authorized_operator(&oracle_operator.key()) @ ErrorCode::UnauthorizedOperator,
    )]
    pub oracle: Account<'info, Oracle>,
    pub oracle_operator: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = oracle_operator,
    )]
    pub oracle_operator_token_account: Account<'info, TokenAccount>,
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
