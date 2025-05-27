use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

// Constants for space calculation
pub const ORACLE_SIZE: usize = 8 + 32 + 1 + 2 + 1 + 4 + 4;
pub const GAME_TOKEN_SIZE: usize = 8 + 32 + 8 + 8 + 1;
pub const PLAYER_BALANCE_SIZE: usize = 8 + 32 + 32 + 8;

// Oracle account that manages global game settings and authority
#[account]
#[derive(Default)]
pub struct Oracle {
    // Authority that can update oracle settings and claim fees
    pub authority: Pubkey,
    // Percentage of game amount taken as fee (0-100)
    pub fee_percentage: u8,
    // Buffer time in seconds after game timeout before cancellation is allowed
    pub oracle_buffer_time: u16,
    // Maximum number of players allowed in a game (realistically never > 255)
    pub max_players: u8,
    // Maximum timeout duration in seconds for a game
    pub max_timeout: u32,
    // Minimum timeout duration in seconds for a game
    pub min_timeout: u32,
}

impl Oracle {
    // Helper method to update oracle configuration
    pub fn update_config(
        &mut self,
        fee_percentage: u8,
        oracle_buffer_time: u16,
        max_players: u8,
        max_timeout: u32,
        min_timeout: u32,
        new_authority: Pubkey,
    ) {
        self.fee_percentage = fee_percentage;
        self.oracle_buffer_time = oracle_buffer_time;
        self.max_players = max_players;
        self.max_timeout = max_timeout;
        self.min_timeout = min_timeout;
        self.authority = new_authority;
    }
}

// Game token configuration for supported tokens
#[account]
#[derive(Default)]
pub struct GameToken {
    // The token mint address
    pub token_mint: Pubkey,
    // Minimum amount required to participate in games
    pub min_amount: u64,
    // Accumulated fee amount for this token
    pub fee_amount: u64,
    // Whether this token is enabled for games
    pub enabled: bool,
}

impl GameToken {
    // Helper method to update token configuration
    pub fn update_config(&mut self, min_amount: u64, enabled: bool) {
        self.min_amount = min_amount;
        self.enabled = enabled;
    }

    // Helper method to initialize token with mint
    pub fn initialize(&mut self, token_mint: Pubkey, min_amount: u64, enabled: bool) {
        self.token_mint = token_mint;
        self.min_amount = min_amount;
        self.fee_amount = 0;
        self.enabled = enabled;
    }
}

// Player's balance for a specific token
#[account]
#[derive(Default)]
pub struct PlayerBalance {
    // Player's public key
    pub player: Pubkey,
    // Token mint address
    pub token_mint: Pubkey,
    // Current balance amount
    pub amount: u64,
}

impl PlayerBalance {
    // Helper method to refund amount to player balance
    pub fn refund(&mut self, amount: u64) {
        self.amount += amount;
    }
}

// Type of game being played
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameType {
    // Two or more players compete for the pot
    Coinflip,
    // One or more players compete for a giveaway
    Giveaway,
}

impl Default for GameType {
    fn default() -> Self {
        GameType::Coinflip
    }
}

// Game instance that manages player participation and winner determination
#[account]
#[derive(Default)]
pub struct Game {
    // Creator of the game
    pub creator: Pubkey,
    // Type of game being played
    pub game_type: GameType,
    // Amount each player must contribute
    pub amount: u64,
    // Maximum number of players allowed (realistically never > 255)
    pub max_players: u8,
    // Minimum number of players required (realistically never > 255)
    pub min_players: u8,
    // List of players who have joined
    pub players: Vec<Pubkey>,
    // Token mint used for this game
    pub token_mint: Pubkey,
    // Timestamp when game was created
    pub created_at: u64,
    // Timeout duration in seconds
    pub timeout: u32,
    // Whether this is a private game requiring oracle approval
    pub is_private: bool,
}

impl Game {
    // Calculate space needed for a game account based on max players
    pub fn space(max_players: u8) -> usize {
        8 + 32 + 1 + 8 + 1 + 1 + 4 + (32 * max_players as usize) + 32 + 8 + 4 + 1
    }

    // Checks if the game meets minimum requirements and timeout conditions
    pub fn ready_for_oracle(&self, current_time: i64) -> bool {
        let has_min_players = self.players.len() >= self.min_players as usize;
        let has_max_players = self.players.len() == self.max_players as usize;
        let timeout_met = current_time as u64 >= self.created_at + self.timeout as u64;

        (has_min_players && timeout_met) || has_max_players
    }

    // Checks if the oracle buffer time has passed for cancellation
    pub fn buffer_passed(&self, oracle_buffer_time: u16, current_time: i64) -> bool {
        current_time as u64 >= self.created_at + self.timeout as u64 + oracle_buffer_time as u64
    }

    // Derives the PDA for this game using the secret key
    pub fn derive_pda(&self, secret_key: [u8; 64]) -> Pubkey {
        let random_hash = hash(secret_key.as_ref());
        let (pda, _) = Pubkey::find_program_address(&[b"game", random_hash.as_ref()], &crate::ID);
        pda
    }

    // Calculates the winner using cryptographic randomness
    pub fn calculate_winner(&self, secret_key: [u8; 64]) -> Pubkey {
        let n_players = self.players.len() as u64;
        if n_players == 1 {
            return self.players[0];
        }

        // Use first 8 bytes of secret key as random seed
        let random_number = u64::from_le_bytes(secret_key[0..8].try_into().unwrap());

        // Ensure fair distribution by avoiding modulo bias
        let max_valid = u64::MAX - (u64::MAX % n_players);
        let final_number = random_number % max_valid;
        let index = (final_number % n_players) as usize;

        self.players[index]
    }

    // Calculates prize distribution with fee deduction
    pub fn calculate_amounts(&self, players_len: u64, fee_percentage: u8) -> (u64, u64) {
        let total_amount = self.amount * players_len;
        let fee_amount = total_amount * fee_percentage as u64 / 100;
        let winner_amount = total_amount - fee_amount;
        (winner_amount, fee_amount)
    }

    // Helper method to handle player refunds based on game type and state
    pub fn refund_player(&self, player_balance: &mut PlayerBalance, player_key: &Pubkey) -> bool {
        match self.game_type {
            GameType::Giveaway => {
                // For giveaway games, always refund to creator (creator puts up the prize)
                if *player_key == self.creator {
                    player_balance.refund(self.amount);
                    true
                } else {
                    false
                }
            }
            GameType::Coinflip => {
                // For coinflip games, refund if player has stake in the game
                if self.players.contains(player_key) {
                    player_balance.refund(self.amount);
                    true
                } else {
                    false
                }
            }
        }
    }
}

// Consolidated token transfer helper that can handle both regular and PDA-signed transfers
pub fn transfer_tokens<'info>(
    from_account: &anchor_lang::prelude::AccountInfo<'info>,
    to_account: &anchor_lang::prelude::AccountInfo<'info>,
    authority: &anchor_lang::prelude::AccountInfo<'info>,
    token_program: &anchor_lang::prelude::AccountInfo<'info>,
    amount: u64,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    use anchor_spl::token;

    let transfer_instruction = token::Transfer {
        from: from_account.clone(),
        to: to_account.clone(),
        authority: authority.clone(),
    };

    match signer_seeds {
        Some(seeds) => {
            token::transfer(
                anchor_lang::prelude::CpiContext::new_with_signer(
                    token_program.clone(),
                    transfer_instruction,
                    seeds,
                ),
                amount,
            )?;
        }
        None => {
            token::transfer(
                anchor_lang::prelude::CpiContext::new(token_program.clone(), transfer_instruction),
                amount,
            )?;
        }
    }

    Ok(())
}

// Updated helper function for player token transfers
pub fn handle_player_token_transfer<'info>(
    player_balance: &mut PlayerBalance,
    game_amount: u64,
    player_token_account: &anchor_lang::prelude::AccountInfo<'info>,
    game_token_account: &anchor_lang::prelude::AccountInfo<'info>,
    player: &anchor_lang::prelude::AccountInfo<'info>,
    token_program: &anchor_lang::prelude::AccountInfo<'info>,
) -> Result<()> {
    let needed_amount = if player_balance.amount >= game_amount {
        player_balance.amount -= game_amount;
        0
    } else {
        let needed = game_amount - player_balance.amount;
        player_balance.amount = 0;
        needed
    };

    // Only transfer if additional tokens are needed
    if needed_amount > 0 {
        transfer_tokens(
            player_token_account,
            game_token_account,
            player,
            token_program,
            needed_amount,
            None,
        )?;
    }

    Ok(())
}

// Updated helper function for PDA-signed token transfers
pub fn handle_pda_token_transfer<'info>(
    from_account: &anchor_lang::prelude::AccountInfo<'info>,
    to_account: &anchor_lang::prelude::AccountInfo<'info>,
    authority: &anchor_lang::prelude::AccountInfo<'info>,
    token_program: &anchor_lang::prelude::AccountInfo<'info>,
    token_mint: &anchor_lang::prelude::Pubkey,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    let signer_seeds = &[b"game_vault", token_mint.as_ref(), &[vault_bump]];

    transfer_tokens(
        from_account,
        to_account,
        authority,
        token_program,
        amount,
        Some(&[signer_seeds]),
    )
}
