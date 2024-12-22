use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Config {
    pub treasury: Pubkey,
    pub fee_percentage: u8,
    pub operator: Pubkey,
    pub game_counter: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameType {
    Coinflip,
    Giveaway,
}

impl Default for GameType {
    fn default() -> Self {
        GameType::Coinflip
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Copy)]
pub enum GameStatus {
    Active,
    ReadyForClaim,
    Completed,
    Cancelled,
}

impl Default for GameStatus {
    fn default() -> Self {
        GameStatus::Active
    }
}

#[account]
#[derive(Default)]
pub struct Game {
    pub id: u64,
    pub creator: Pubkey,
    pub game_type: GameType,
    pub amount: u64,
    pub max_participants: u16,
    pub min_participants: u16,
    pub participants: Vec<Pubkey>,
    pub winner: u16,
    pub status: GameStatus,
    pub token_mint: Pubkey,
    pub created_at: i64,
    pub timeout: i64,
    pub is_private: bool,
}

impl Game {
    pub fn add_participant(&mut self, player: Pubkey) {
        self.participants.push(player);
    }

    pub fn is_ready_for_oracle(&self) -> bool {
        self.participants.len() >= self.min_participants as usize
            && (Clock::get().unwrap().unix_timestamp >= self.created_at + self.timeout
                || self.participants.len() == self.max_participants as usize)
    }

    pub fn get_winner(&self) -> Pubkey {
        self.participants[self.winner as usize]
    }
}
