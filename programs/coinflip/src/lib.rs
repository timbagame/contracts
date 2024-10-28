use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("BzU9WwzqMoDSTTdTurweMLp2tAciFpZaNL2bPUitwNyy");

// Constants
pub const FEE_COLLECTOR: &str = "HhEWJstpJE6vvrYGS3BaK5ZJbdVAXqGmQ2MBM8FyiPvy";
pub const GAME_TOKEN: &str = "F3A1baCgv4TF79TSjdMTvpMDtNv8DJvHZwNc9DG8pump";
pub const FEE_PERCENTAGE: u64 = 1; // 1% fee

#[program]
pub mod coinflip {
    use super::*;

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_type: GameType,
        amount: u64,
        max_participants: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.token_mint.key().to_string() == GAME_TOKEN,
            ErrorCode::InvalidToken
        );

        let game = &mut ctx.accounts.game;
        game.creator = ctx.accounts.creator.key();
        game.game_type = game_type;
        game.amount = amount;
        game.max_participants = max_participants;
        game.participants = Vec::new();
        game.winner = None;
        game.status = GameStatus::Active;
        game.token_mint = ctx.accounts.token_mint.key();
        game.oracle_hash = None;
        game.ready_for_oracle = false;

        // Lock creator's tokens for giveaway
        if game_type == GameType::Giveaway {
            let transfer_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            );
            token::transfer(transfer_ctx, amount)?;
        }

        Ok(())
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);
        require!(
            game.participants.len() < game.max_participants as usize,
            ErrorCode::GameFull
        );
        require!(game.oracle_hash.is_none(), ErrorCode::OracleHashAlreadySet);

        // Check if player already joined
        require!(
            !game.participants.contains(&ctx.accounts.player.key()),
            ErrorCode::AlreadyJoined
        );

        // Transfer tokens to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, game.amount)?;

        // Add player to participants
        game.participants.push(ctx.accounts.player.key());

        // Mark game ready for oracle hash if full
        if game.participants.len() == game.max_participants as usize {
            game.ready_for_oracle = true;
        }

        Ok(())
    }

    pub fn set_oracle_hash(ctx: Context<SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
        require!(
            ctx.accounts.oracle.key().to_string() == FEE_COLLECTOR,
            ErrorCode::InvalidOracle
        );

        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);
        require!(game.ready_for_oracle, ErrorCode::GameNotFull);
        require!(game.oracle_hash.is_none(), ErrorCode::OracleHashAlreadySet);

        game.oracle_hash = Some(hash_value);

        // Now that we have the oracle hash, determine the winner
        let blockhash = ctx.accounts.recent_blockhash.key().to_bytes();

        // Combine oracle hash with blockhash for randomness
        let mut combined = vec![];
        combined.extend_from_slice(&hash_value);
        combined.extend_from_slice(&blockhash);
        let final_hash = hash(&combined).to_bytes();

        let random_index = (final_hash[0] as usize) % game.participants.len();
        game.winner = Some(game.participants[random_index]);
        game.status = GameStatus::ReadyForClaim;

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.status == GameStatus::ReadyForClaim,
            ErrorCode::GameNotReadyForClaim
        );
        require!(
            game.winner.unwrap() == ctx.accounts.winner.key(),
            ErrorCode::NotWinner
        );

        // Calculate total pot and fee
        let total_pot = game.amount * (game.max_participants as u64);
        let fee_amount = (total_pot * FEE_PERCENTAGE) / 100;
        let winner_amount = total_pot - fee_amount;

        // Transfer fee to fee collector
        let fee_transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.fee_collector_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
        );
        token::transfer(fee_transfer_ctx, fee_amount)?;

        // Transfer winnings to winner
        let winner_transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
        );
        token::transfer(winner_transfer_ctx, winner_amount)?;

        game.status = GameStatus::Completed;
        Ok(())
    }

    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        let game = &mut ctx.accounts.game;

        require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);

        // Return tokens to participants
        for participant in &game.participants {
            let transfer_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.participant_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
            );
            token::transfer(transfer_ctx, game.amount)?;
        }

        game.status = GameStatus::Cancelled;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum GameType {
    Coinflip,
    Giveaway,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum GameStatus {
    Active,
    ReadyForClaim,
    Completed,
    Cancelled,
}

#[account]
pub struct Game {
    pub creator: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub max_participants: u8,
    pub participants: Vec<Pubkey>,
    pub winner: Option<Pubkey>,
    pub status: GameStatus,
    pub token_mint: Pubkey,
    pub oracle_hash: Option<[u8; 32]>,
    pub ready_for_oracle: bool,
}

#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(init, payer = creator, space = 8 + 32 + 1 + 8 + 1 + 32 * 10 + 33 + 1 + 32 + 33 + 1)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_mint: Account<'info, token::Mint>,
    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetOracleHash<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub oracle: Signer<'info>,
    /// CHECK: Used for randomness
    pub recent_blockhash: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut)]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub winner: Signer<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub fee_collector_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA for vault authority
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub participant_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA for vault authority
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Game is already full")]
    GameFull,
    #[msg("Player has already joined")]
    AlreadyJoined,
    #[msg("Invalid token mint")]
    InvalidToken,
    #[msg("Invalid oracle address")]
    InvalidOracle,
    #[msg("Oracle hash already set")]
    OracleHashAlreadySet,
    #[msg("Game not full yet")]
    GameNotFull,
    #[msg("Game not ready for claim")]
    GameNotReadyForClaim,
    #[msg("Not the winner")]
    NotWinner,
}
