#![allow(dead_code, clippy::result_large_err, clippy::too_many_arguments)]

use {
    anchor_lang::{
        prelude::{Pubkey, Rent},
        solana_program::{
            bpf_loader_upgradeable::{self, UpgradeableLoaderState},
            instruction::Instruction,
            program_pack::Pack,
            system_program,
        },
        InstructionData, ToAccountMetas,
    },
    litesvm::{types::TransactionResult, LiteSVM},
    solana_instruction::error::InstructionError,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
    spl_associated_token_account_interface::{
        address::get_associated_token_address_with_program_id,
        instruction::create_associated_token_account, program::ID as ASSOCIATED_TOKEN_PROGRAM_ID,
    },
    spl_token_interface::{
        instruction as token_instruction,
        state::{Account as TokenAccount, Mint},
        ID as TOKEN_PROGRAM_ID,
    },
    timba::{error::ErrorCode, GameConfig, OracleConfig, TokenConfig},
};

pub struct TokenFixture {
    pub mint: Keypair,
    pub game_token: Pubkey,
    pub game_vault: Pubkey,
    pub vault_ata: Pubkey,
}

/// On-chain custom error number for an Anchor `ErrorCode` (includes offset).
pub fn anchor_error(code: ErrorCode) -> u32 {
    u32::from(code)
}

/// Extract a program `Custom(u32)` from a failed LiteSVM transaction.
pub fn custom_error_code(result: TransactionResult) -> u32 {
    match result.expect_err("transaction should fail").err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!("expected InstructionError::Custom, got {other:?}"),
    }
}

pub fn set_program_upgrade_authority(
    svm: &mut LiteSVM,
    program_id: Pubkey,
    authority: Pubkey,
) -> Pubkey {
    let program_data =
        Pubkey::find_program_address(&[program_id.as_ref()], &bpf_loader_upgradeable::ID).0;
    let mut account = svm
        .get_account(&program_data)
        .expect("upgradeable program data must exist");
    let metadata = bincode::serialize(&UpgradeableLoaderState::ProgramData {
        slot: svm.get_sysvar::<anchor_lang::prelude::Clock>().slot,
        upgrade_authority_address: Some(authority),
    })
    .unwrap();
    account.data[..metadata.len()].copy_from_slice(&metadata);
    svm.set_account(program_data, account).unwrap();
    program_data
}

pub struct TimbaFixture {
    pub svm: LiteSVM,
    pub operator: Keypair,
    pub oracle: Pubkey,
    pub program_data: Pubkey,
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
        let program_data = set_program_upgrade_authority(&mut svm, timba::id(), operator.pubkey());
        svm.airdrop(&operator.pubkey(), 100_000_000_000).unwrap();
        let mut fixture = Self {
            svm,
            operator,
            oracle,
            program_data,
        };
        fixture.initialize_oracle();
        fixture
    }

    pub fn send(&mut self, instructions: &[Instruction], signers: &[&Keypair]) -> bool {
        match self.send_result(instructions, signers) {
            Ok(_) => true,
            Err(error) => {
                eprintln!("LiteSVM transaction failed: {error:?}");
                false
            }
        }
    }

    pub fn send_result(
        &mut self,
        instructions: &[Instruction],
        signers: &[&Keypair],
    ) -> TransactionResult {
        let message = Message::new_with_blockhash(
            instructions,
            Some(&self.operator.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let transaction =
            VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
        let result = self.svm.send_transaction(transaction);
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
                upgrade_authority: self.operator.pubkey(),
                program: timba::id(),
                program_data: self.program_data,
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
        let token = self.uninitialized_token_fixture(mint);
        let instruction = self.initialize_token_instruction(
            &token,
            TokenConfig {
                min_amount: 1_000,
                enabled: true,
            },
        );
        let operator = self.operator.insecure_clone();
        assert!(self.send(&[instruction], &[&operator]));
        token
    }

    pub fn uninitialized_token_fixture(&mut self, mint: Keypair) -> TokenFixture {
        let game_token =
            Pubkey::find_program_address(&[b"game_token", mint.pubkey().as_ref()], &timba::id()).0;
        let game_vault =
            Pubkey::find_program_address(&[b"game_vault", mint.pubkey().as_ref()], &timba::id()).0;
        let vault_ata = self.create_ata(game_vault, mint.pubkey());
        TokenFixture {
            mint,
            game_token,
            game_vault,
            vault_ata,
        }
    }

    pub fn initialize_token_instruction(
        &self,
        token: &TokenFixture,
        config: TokenConfig,
    ) -> Instruction {
        self.initialize_token_instruction_with_accounts(
            token,
            config,
            self.operator.pubkey(),
            TOKEN_PROGRAM_ID,
        )
    }

    pub fn initialize_token_instruction_with_accounts(
        &self,
        token: &TokenFixture,
        config: TokenConfig,
        oracle_operator: Pubkey,
        token_program: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::InitializeToken { config }.data(),
            timba::accounts::InitializeToken {
                game_token: token.game_token,
                token_mint: token.mint.pubkey(),
                game_vault: token.game_vault,
                game_token_account: token.vault_ata,
                oracle: self.oracle,
                oracle_operator,
                system_program: system_program::ID,
                token_program,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
        )
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

    pub fn empty_player(&mut self, mint: Pubkey) -> (Keypair, Pubkey) {
        let player = Keypair::new();
        self.svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();
        let ata = self.create_ata(player.pubkey(), mint);
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
        let oracle_operator = self.operator.insecure_clone();
        self.initialize_game_with_operator(
            token,
            creator,
            creator_ata,
            config,
            random_hash,
            &oracle_operator,
        )
    }

    pub fn initialize_game_with_operator(
        &mut self,
        token: &TokenFixture,
        creator: &Keypair,
        creator_ata: Pubkey,
        config: GameConfig,
        random_hash: [u8; 32],
        oracle_operator: &Keypair,
    ) -> Pubkey {
        let (game, instruction) = self.initialize_game_instruction_with_operator(
            token,
            creator.pubkey(),
            creator_ata,
            config,
            random_hash,
            oracle_operator.pubkey(),
        );
        let payer = self.operator.insecure_clone();
        let signers = if payer.pubkey() == oracle_operator.pubkey() {
            vec![&payer, creator]
        } else {
            vec![&payer, creator, oracle_operator]
        };
        assert!(self.send(&[instruction], &signers));
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
        self.initialize_game_instruction_with_operator(
            token,
            creator,
            creator_ata,
            config,
            random_hash,
            self.operator.pubkey(),
        )
    }

    pub fn initialize_game_instruction_with_operator(
        &self,
        token: &TokenFixture,
        creator: Pubkey,
        creator_ata: Pubkey,
        config: GameConfig,
        random_hash: [u8; 32],
        oracle_operator: Pubkey,
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
                oracle_operator,
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
        self.join_instruction_with_operator(token, game, player, player_ata, None)
    }

    pub fn join_instruction_with_operator(
        &self,
        token: &TokenFixture,
        game: Pubkey,
        player: Pubkey,
        player_ata: Pubkey,
        oracle_operator: Option<Pubkey>,
    ) -> Instruction {
        Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::JoinGame {}.data(),
            timba::accounts::JoinGame {
                game,
                player,
                oracle_operator,
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
        let instruction = self.complete_instruction(
            token,
            game,
            random_hash,
            secret_key,
            winner_index,
            winner,
            winner_ata,
            creator,
            self.operator.pubkey(),
        );
        let operator = self.operator.insecure_clone();
        self.send(&[instruction], &[&operator])
    }

    #[allow(clippy::too_many_arguments)]
    pub fn complete_instruction(
        &self,
        token: &TokenFixture,
        game: Pubkey,
        random_hash: [u8; 32],
        secret_key: [u8; 32],
        winner_index: u32,
        winner: Pubkey,
        winner_ata: Pubkey,
        creator: Pubkey,
        oracle_operator: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
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
                oracle_operator,
                winner,
                creator,
                winner_token_account: winner_ata,
            }
            .to_account_metas(None),
        )
    }

    pub fn close_game(
        &mut self,
        token: &TokenFixture,
        game: Pubkey,
        creator: &Keypair,
        creator_ata: Pubkey,
    ) -> bool {
        let instruction = self.close_game_instruction(token, game, creator.pubkey(), creator_ata);
        let operator = self.operator.insecure_clone();
        self.send(&[instruction], &[&operator, creator])
    }

    pub fn close_game_instruction(
        &self,
        token: &TokenFixture,
        game: Pubkey,
        creator: Pubkey,
        creator_ata: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::CloseGame {}.data(),
            timba::accounts::CloseGame {
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
            }
            .to_account_metas(None),
        )
    }

    pub fn token_balance(&self, token_account: Pubkey) -> u64 {
        let account = self.svm.get_account(&token_account).unwrap();
        TokenAccount::unpack(&account.data).unwrap().amount
    }

    pub fn set_token_balance(&mut self, token_account: Pubkey, amount: u64) {
        let mut account = self.svm.get_account(&token_account).unwrap();
        let mut state = TokenAccount::unpack(&account.data).unwrap();
        state.amount = amount;
        TokenAccount::pack(state, &mut account.data).unwrap();
        self.svm.set_account(token_account, account).unwrap();
    }

    pub fn update_token(
        &mut self,
        token: &TokenFixture,
        signer: &Keypair,
        config: TokenConfig,
    ) -> bool {
        let instruction = self.update_token_instruction(token, signer.pubkey(), config);
        if signer.pubkey() == self.operator.pubkey() {
            self.send(&[instruction], &[signer])
        } else {
            let operator = self.operator.insecure_clone();
            self.send(&[instruction], &[&operator, signer])
        }
    }

    pub fn update_token_instruction(
        &self,
        token: &TokenFixture,
        signer: Pubkey,
        config: TokenConfig,
    ) -> Instruction {
        Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::UpdateToken { config }.data(),
            timba::accounts::UpdateToken {
                game_token: token.game_token,
                token_mint: token.mint.pubkey(),
                oracle: self.oracle,
                oracle_operator: signer,
            }
            .to_account_metas(None),
        )
    }

    pub fn close_token(&mut self, token: &TokenFixture, signer: &Keypair) -> bool {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::CloseToken {}.data(),
            timba::accounts::CloseToken {
                token_mint: token.mint.pubkey(),
                game_token: token.game_token,
                game_vault: token.game_vault,
                game_token_account: token.vault_ata,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                oracle: self.oracle,
                oracle_operator: signer.pubkey(),
            }
            .to_account_metas(None),
        );
        if signer.pubkey() == self.operator.pubkey() {
            self.send(&[instruction], &[signer])
        } else {
            let operator = self.operator.insecure_clone();
            self.send(&[instruction], &[&operator, signer])
        }
    }

    pub fn withdraw_fees(
        &mut self,
        token: &TokenFixture,
        signer: &Keypair,
        destination: Pubkey,
    ) -> bool {
        let instruction = self.withdraw_fees_instruction(token, signer.pubkey(), destination);
        if signer.pubkey() == self.operator.pubkey() {
            self.send(&[instruction], &[signer])
        } else {
            let operator = self.operator.insecure_clone();
            self.send(&[instruction], &[&operator, signer])
        }
    }

    pub fn withdraw_fees_instruction(
        &self,
        token: &TokenFixture,
        signer: Pubkey,
        destination: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::WithdrawTokenFee {}.data(),
            timba::accounts::WithdrawTokenFee {
                game_token_ctx: timba::accounts::GameTokenContext {
                    token_mint: token.mint.pubkey(),
                    game_token: token.game_token,
                    game_vault: token.game_vault,
                    game_token_account: token.vault_ata,
                    token_program: TOKEN_PROGRAM_ID,
                    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                oracle: self.oracle,
                oracle_operator: signer,
                oracle_operator_token_account: destination,
            }
            .to_account_metas(None),
        )
    }

    pub fn update_oracle(&mut self, signer: &Keypair, config: OracleConfig) -> bool {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::UpdateOracle { config }.data(),
            timba::accounts::UpdateOracle {
                oracle: self.oracle,
                old_oracle_operator: signer.pubkey(),
                new_oracle_operator: signer.pubkey(),
            }
            .to_account_metas(None),
        );
        if signer.pubkey() == self.operator.pubkey() {
            self.send(&[instruction], &[signer])
        } else {
            let operator = self.operator.insecure_clone();
            self.send(&[instruction], &[&operator, signer])
        }
    }

    pub fn rotate_oracle(
        &mut self,
        old_operator: &Keypair,
        new_operator: &Keypair,
        config: OracleConfig,
    ) -> bool {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::UpdateOracle { config }.data(),
            timba::accounts::UpdateOracle {
                oracle: self.oracle,
                old_oracle_operator: old_operator.pubkey(),
                new_oracle_operator: new_operator.pubkey(),
            }
            .to_account_metas(None),
        );
        if old_operator.pubkey() == self.operator.pubkey() {
            self.send(&[instruction], &[old_operator, new_operator])
        } else {
            let payer = self.operator.insecure_clone();
            self.send(&[instruction], &[&payer, old_operator, new_operator])
        }
    }
}
use crate::timba;
