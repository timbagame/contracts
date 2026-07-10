#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{Pubkey, Rent},
        solana_program::{instruction::Instruction, program_pack::Pack, system_program},
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::versioned::VersionedTransaction,
    spl_associated_token_account_interface::{
        address::get_associated_token_address_with_program_id,
        instruction::create_associated_token_account, program::ID as ASSOCIATED_TOKEN_PROGRAM_ID,
    },
    spl_token_interface::{
        instruction as token_instruction,
        state::{Account as TokenAccount, Mint},
        ID as TOKEN_PROGRAM_ID,
    },
    timba::{GameConfig, OracleConfig, TokenConfig},
};

pub struct TokenFixture {
    pub mint: Keypair,
    pub game_token: Pubkey,
    pub game_vault: Pubkey,
    pub vault_ata: Pubkey,
}

pub struct TimbaFixture {
    pub svm: LiteSVM,
    pub operator: Keypair,
    pub oracle: Pubkey,
}

impl TimbaFixture {
    pub fn new() -> Self {
        let operator = Keypair::new();
        let oracle = Pubkey::find_program_address(&[b"oracle"], &timba::id()).0;
        let mut svm = LiteSVM::new();
        svm.add_program(
            timba::id(),
            include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/timba.so")),
        )
        .unwrap();
        svm.airdrop(&operator.pubkey(), 100_000_000_000).unwrap();
        let mut fixture = Self {
            svm,
            operator,
            oracle,
        };
        fixture.initialize_oracle();
        fixture
    }

    pub fn send(&mut self, instructions: &[Instruction], signers: &[&Keypair]) -> bool {
        let message = Message::new_with_blockhash(
            instructions,
            Some(&self.operator.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let transaction =
            VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
        let result = match self.svm.send_transaction(transaction) {
            Ok(_) => true,
            Err(error) => {
                eprintln!("LiteSVM transaction failed: {error:?}");
                false
            }
        };
        self.svm.expire_blockhash();
        result
    }

    fn initialize_oracle(&mut self) {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::InitializeOracle {
                config: OracleConfig {
                    fee_percentage: 5,
                    oracle_buffer_time: 5,
                    max_tickets: 2_048,
                    max_timeout: 86_400,
                    min_timeout: 1,
                },
            }
            .data(),
            timba::accounts::InitializeOracle {
                oracle: self.oracle,
                oracle_operator: self.operator.pubkey(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let operator = self.operator.insecure_clone();
        assert!(self.send(&[instruction], &[&operator]));
    }

    pub fn create_mint(&mut self) -> Keypair {
        let mint = Keypair::new();
        let rent = self.svm.get_sysvar::<Rent>();
        let instructions = [
            system_instruction::create_account(
                &self.operator.pubkey(),
                &mint.pubkey(),
                rent.minimum_balance(Mint::LEN),
                Mint::LEN as u64,
                &TOKEN_PROGRAM_ID,
            ),
            token_instruction::initialize_mint2(
                &TOKEN_PROGRAM_ID,
                &mint.pubkey(),
                &self.operator.pubkey(),
                None,
                6,
            )
            .unwrap(),
        ];
        let operator = self.operator.insecure_clone();
        assert!(self.send(&instructions, &[&operator, &mint]));
        mint
    }

    pub fn create_ata(&mut self, owner: Pubkey, mint: Pubkey) -> Pubkey {
        let ata = get_associated_token_address_with_program_id(&owner, &mint, &TOKEN_PROGRAM_ID);
        let instruction = create_associated_token_account(
            &self.operator.pubkey(),
            &owner,
            &mint,
            &TOKEN_PROGRAM_ID,
        );
        let operator = self.operator.insecure_clone();
        assert!(self.send(&[instruction], &[&operator]));
        ata
    }

    pub fn initialize_token(&mut self, mint: Pubkey) -> (Pubkey, Pubkey, Pubkey) {
        let game_token =
            Pubkey::find_program_address(&[b"game_token", mint.as_ref()], &timba::id()).0;
        let game_vault =
            Pubkey::find_program_address(&[b"game_vault", mint.as_ref()], &timba::id()).0;
        let vault_ata = self.create_ata(game_vault, mint);
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::InitializeToken {
                config: TokenConfig {
                    min_amount: 1_000,
                    enabled: true,
                },
            }
            .data(),
            timba::accounts::InitializeToken {
                game_token,
                token_mint: mint,
                game_vault,
                game_token_account: vault_ata,
                oracle: self.oracle,
                oracle_operator: self.operator.pubkey(),
                system_program: system_program::ID,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
        );
        let operator = self.operator.insecure_clone();
        assert!(self.send(&[instruction], &[&operator]));
        (game_token, game_vault, vault_ata)
    }

    pub fn token_fixture(&mut self) -> TokenFixture {
        let mint = self.create_mint();
        let (game_token, game_vault, vault_ata) = self.initialize_token(mint.pubkey());
        TokenFixture {
            mint,
            game_token,
            game_vault,
            vault_ata,
        }
    }

    pub fn funded_player(&mut self, mint: Pubkey, amount: u64) -> (Keypair, Pubkey) {
        let player = Keypair::new();
        self.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let ata = self.create_ata(player.pubkey(), mint);
        let instruction = token_instruction::mint_to_checked(
            &TOKEN_PROGRAM_ID,
            &mint,
            &ata,
            &self.operator.pubkey(),
            &[],
            amount,
            6,
        )
        .unwrap();
        let operator = self.operator.insecure_clone();
        assert!(self.send(&[instruction], &[&operator]));
        (player, ata)
    }

    pub fn initialize_game(
        &mut self,
        token: &TokenFixture,
        creator: &Keypair,
        creator_ata: Pubkey,
        config: GameConfig,
        random_hash: [u8; 32],
    ) -> Pubkey {
        let (game, instruction) = self.initialize_game_instruction(
            token,
            creator.pubkey(),
            creator_ata,
            config,
            random_hash,
        );
        let operator = self.operator.insecure_clone();
        assert!(self.send(&[instruction], &[&operator, creator]));
        game
    }

    pub fn initialize_game_instruction(
        &self,
        token: &TokenFixture,
        creator: Pubkey,
        creator_ata: Pubkey,
        config: GameConfig,
        random_hash: [u8; 32],
    ) -> (Pubkey, Instruction) {
        let game = Pubkey::find_program_address(&[b"game", &random_hash], &timba::id()).0;
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::InitializeGame {
                config,
                _random_hash: random_hash,
            }
            .data(),
            timba::accounts::InitializeGame {
                game,
                creator,
                oracle: self.oracle,
                game_token_ctx: timba::accounts::GameTokenContext {
                    token_mint: token.mint.pubkey(),
                    game_token: token.game_token,
                    game_vault: token.game_vault,
                    game_token_account: token.vault_ata,
                    token_program: TOKEN_PROGRAM_ID,
                    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                creator_token_account: creator_ata,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        (game, instruction)
    }

    pub fn join_game(
        &mut self,
        token: &TokenFixture,
        game: Pubkey,
        player: &Keypair,
        player_ata: Pubkey,
    ) -> bool {
        let instruction = self.join_instruction(token, game, player.pubkey(), player_ata);
        let operator = self.operator.insecure_clone();
        self.send(&[instruction], &[&operator, player])
    }

    pub fn join_instruction(
        &self,
        token: &TokenFixture,
        game: Pubkey,
        player: Pubkey,
        player_ata: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::JoinGame {}.data(),
            timba::accounts::JoinGame {
                game,
                player,
                oracle_operator: None,
                game_token_ctx: timba::accounts::GameTokenContext {
                    token_mint: token.mint.pubkey(),
                    game_token: token.game_token,
                    game_vault: token.game_vault,
                    game_token_account: token.vault_ata,
                    token_program: TOKEN_PROGRAM_ID,
                    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                player_token_account: player_ata,
                oracle: self.oracle,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn unjoin_game(
        &mut self,
        token: &TokenFixture,
        game: Pubkey,
        player: &Keypair,
        player_ata: Pubkey,
    ) -> bool {
        let instruction =
            self.unjoin_instruction(token, game, player.pubkey(), player.pubkey(), player_ata);
        let operator = self.operator.insecure_clone();
        self.send(&[instruction], &[&operator, player])
    }

    pub fn unjoin_instruction(
        &self,
        token: &TokenFixture,
        game: Pubkey,
        player: Pubkey,
        authority: Pubkey,
        player_ata: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::UnjoinGame {}.data(),
            timba::accounts::UnjoinGame {
                game,
                player,
                authority,
                oracle: self.oracle,
                game_token_ctx: timba::accounts::GameTokenContext {
                    token_mint: token.mint.pubkey(),
                    game_token: token.game_token,
                    game_vault: token.game_vault,
                    game_token_account: token.vault_ata,
                    token_program: TOKEN_PROGRAM_ID,
                    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                player_token_account: player_ata,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn complete_game(
        &mut self,
        token: &TokenFixture,
        game: Pubkey,
        random_hash: [u8; 32],
        secret_key: [u8; 32],
        winner_index: u32,
        winner: Pubkey,
        winner_ata: Pubkey,
        creator: Pubkey,
    ) -> bool {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::CompleteGame {
                _random_hash: random_hash,
                secret_key,
                winner_index,
            }
            .data(),
            timba::accounts::CompleteGame {
                game,
                game_token_ctx: timba::accounts::GameTokenContext {
                    token_mint: token.mint.pubkey(),
                    game_token: token.game_token,
                    game_vault: token.game_vault,
                    game_token_account: token.vault_ata,
                    token_program: TOKEN_PROGRAM_ID,
                    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                oracle: self.oracle,
                oracle_operator: self.operator.pubkey(),
                winner,
                creator,
                winner_token_account: winner_ata,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let operator = self.operator.insecure_clone();
        self.send(&[instruction], &[&operator])
    }

    pub fn close_game(
        &mut self,
        token: &TokenFixture,
        game: Pubkey,
        creator: &Keypair,
        creator_ata: Pubkey,
    ) -> bool {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::CloseGame {}.data(),
            timba::accounts::CloseGame {
                game,
                creator: creator.pubkey(),
                oracle: self.oracle,
                game_token_ctx: timba::accounts::GameTokenContext {
                    token_mint: token.mint.pubkey(),
                    game_token: token.game_token,
                    game_vault: token.game_vault,
                    game_token_account: token.vault_ata,
                    token_program: TOKEN_PROGRAM_ID,
                    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                creator_token_account: creator_ata,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let operator = self.operator.insecure_clone();
        self.send(&[instruction], &[&operator, creator])
    }

    pub fn token_balance(&self, token_account: Pubkey) -> u64 {
        let account = self.svm.get_account(&token_account).unwrap();
        TokenAccount::unpack(&account.data).unwrap().amount
    }
}
