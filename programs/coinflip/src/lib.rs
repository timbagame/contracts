use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program, hash::hash, instruction::Instruction, program::invoke,
};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("BzU9WwzqMoDSTTdTurweMLp2tAciFpZaNL2bPUitwNyy");

#[constant]
pub const MAX_FEE_PERCENTAGE: u64 = 5;

#[account]
pub struct ProgramConfig {
    pub treasury: Pubkey,
    pub game_token: Pubkey,
    pub fee_percentage: u64,
    pub authority: Pubkey,
    pub operator: Pubkey,
}

#[program]
pub mod coinflip {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        game_token: Pubkey,
        fee_percentage: u64,
        operator: Pubkey,
    ) -> Result<()> {
        require!(
            fee_percentage <= MAX_FEE_PERCENTAGE,
            ErrorCode::InvalidFeePercentage
        );

        let config = &mut ctx.accounts.config;
        config.treasury = treasury;
        config.game_token = game_token;
        config.fee_percentage = fee_percentage;
        config.authority = ctx.accounts.authority.key();
        config.operator = operator;

        Ok(())
    }

    pub fn update_authority(ctx: Context<UpdateAuthority>, new_authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;

        require!(
            ctx.accounts.authority.key() == config.authority,
            ErrorCode::Unauthorized
        );

        config.authority = new_authority;

        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_treasury: Option<Pubkey>,
        new_game_token: Option<Pubkey>,
        new_fee_percentage: Option<u64>,
        new_operator: Option<Pubkey>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;

        require!(
            ctx.accounts.authority.key() == config.authority,
            ErrorCode::Unauthorized
        );

        if let Some(treasury) = new_treasury {
            config.treasury = treasury;
        }

        if let Some(game_token) = new_game_token {
            config.game_token = game_token;
        }

        if let Some(fee_percentage) = new_fee_percentage {
            require!(
                fee_percentage <= MAX_FEE_PERCENTAGE,
                ErrorCode::InvalidFeePercentage
            );
            config.fee_percentage = fee_percentage;
        }

        if let Some(operator) = new_operator {
            config.operator = operator;
        }

        Ok(())
    }

    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_type: GameType,
        amount: u64,
        max_participants: u8,
        timeout_duration: i64,
        is_private: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.token_mint.key() == ctx.accounts.config.game_token,
            ErrorCode::InvalidToken
        );

        match game_type {
            GameType::Coinflip => {
                require!(max_participants >= 2, ErrorCode::InvalidParticipantCount);
            }
            GameType::Giveaway => {
                require!(max_participants >= 1, ErrorCode::InvalidParticipantCount);
            }
        }

        let game = &mut ctx.accounts.game;
        game.creator = ctx.accounts.creator.key();
        game.game_type = game_type;
        game.amount = amount;
        game.max_participants = max_participants;
        game.participants = Vec::with_capacity(max_participants as usize);
        game.winner = None;
        game.status = GameStatus::Active;
        game.token_mint = ctx.accounts.token_mint.key();
        game.oracle_hash = None;
        game.ready_for_oracle = false;
        game.created_at = Clock::get()?.unix_timestamp;
        game.timeout_duration = timeout_duration;
        game.is_private = is_private;

        // Transfer tokens to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        // Only add creator to participants if it's a Coinflip game
        if game.game_type == GameType::Coinflip {
            game.participants.push(ctx.accounts.creator.key());
        }

        Ok(())
    }

    pub fn join_game(ctx: Context<JoinGame>, signature: Option<Vec<u8>>) -> Result<()> {
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

        // Check private game authorization
        if game.is_private {
            require!(signature.is_some(), ErrorCode::SignatureRequired);

            // Message to verify: game seed + player public key
            let mut message = Vec::with_capacity(64);
            message.extend_from_slice(&game.game_seed);
            message.extend_from_slice(&ctx.accounts.player.key().to_bytes());

            // Verify operator signature
            require!(
                verify_operator_signature(
                    &ctx.accounts.config.operator,
                    &message,
                    signature.as_ref().unwrap()
                )?,
                ErrorCode::InvalidSignature
            );
        }

        // For giveaway games, players don't need to transfer tokens
        if game.game_type == GameType::Coinflip {
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
        }

        // Add player to participants
        game.participants.push(ctx.accounts.player.key());

        // Mark game ready for oracle if full
        if game.participants.len() == game.max_participants as usize {
            game.ready_for_oracle = true;
        }

        Ok(())
    }

    pub fn set_oracle_hash(ctx: Context<SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
        require!(
            ctx.accounts.oracle.key() == ctx.accounts.config.operator,
            ErrorCode::InvalidOperator
        );

        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);
        require!(game.ready_for_oracle, ErrorCode::GameNotFull);
        require!(game.oracle_hash.is_none(), ErrorCode::OracleHashAlreadySet);

        game.oracle_hash = Some(hash_value);

        // Combine oracle hash with blockhash for randomness
        let blockhash = ctx.accounts.recent_blockhash.key().to_bytes();
        let mut combined = Vec::with_capacity(64);
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
        let config = &ctx.accounts.config;

        require!(
            game.status == GameStatus::ReadyForClaim,
            ErrorCode::GameNotReadyForClaim
        );
        require!(
            game.winner.unwrap() == ctx.accounts.winner.key(),
            ErrorCode::NotWinner
        );

        let total_pot = game.amount * (game.max_participants as u64);
        let fee_amount = (total_pot * config.fee_percentage) / 100;
        let winner_amount = total_pot - fee_amount;

        let fee_transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
        );
        token::transfer(fee_transfer_ctx, fee_amount)?;

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
        let current_time = Clock::get()?.unix_timestamp;

        require!(game.status == GameStatus::Active, ErrorCode::GameNotActive);
        require!(
            current_time >= game.created_at + game.timeout_duration,
            ErrorCode::TimeoutNotReached
        );

        // Return tokens to participants
        for _participant in &game.participants {
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

// Helper function to verify ed25519 signatures
fn verify_operator_signature(
    operator_pubkey: &Pubkey,
    message: &[u8],
    signature: &[u8],
) -> Result<bool> {
    // Verify signature length
    if signature.len() != 64 {
        return Ok(false);
    }

    // Convert signature to fixed size array
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(signature);

    // Create instruction data
    let mut instruction_data = Vec::with_capacity(signature.len() + message.len() + 32);
    instruction_data.extend_from_slice(&sig_bytes);
    instruction_data.extend_from_slice(message);
    instruction_data.extend_from_slice(&operator_pubkey.to_bytes());

    // Create ed25519 program instruction
    let ix = Instruction::new_with_bytes(
        ed25519_program::id(),
        &instruction_data,
        vec![], // No account keys needed
    );

    // Invoke the ed25519 program
    match invoke(&ix, &[]) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
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
    pub created_at: i64,
    pub timeout_duration: i64,
    pub is_private: bool,
    pub game_seed: [u8; 32],
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 32 + 8 + 32 + 32)]
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAuthority<'info> {
    #[account(mut, has_one = authority)]
    pub config: Account<'info, ProgramConfig>,
    pub authority: Signer<'info>, // The current authority
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, has_one = authority)]
    pub config: Account<'info, ProgramConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(init, payer = creator, space = 8 + 32 + 1 + 8 + 1 + 32 * 10 + 33 + 1 + 32 + 33 + 1 + 8 + 8 + 1 + 64 * 10)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub config: Account<'info, ProgramConfig>,
    pub token_mint: Account<'info, token::Mint>,
    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorizePlayer<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub config: Account<'info, ProgramConfig>,
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub config: Account<'info, ProgramConfig>,
    #[account(mut)]
    pub winner: Signer<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA for vault authority
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetOracleHash<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    pub config: Account<'info, ProgramConfig>,
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
    #[account(mut)]
    pub config: Account<'info, ProgramConfig>,
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
    #[msg("Not authorized to perform this action.")]
    Unauthorized,
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
    #[msg("Fee percentage must be between 0 and 100")]
    InvalidFeePercentage,
    #[msg("Signature required for private game")]
    SignatureRequired,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Game is not private")]
    GameNotPrivate,
    #[msg("Invalid operator")]
    InvalidOperator,
    #[msg("Timeout not reached")]
    TimeoutNotReached,
    #[msg("Game must have at least 2 participants")]
    InvalidParticipantCount,
}
