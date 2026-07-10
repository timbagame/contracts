use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    timba::{state::Oracle, OracleConfig},
};

fn config() -> OracleConfig {
    OracleConfig {
        fee_percentage: 5,
        oracle_buffer_time: 10,
        max_tickets: 1_024,
        max_timeout: 86_400,
        min_timeout: 1,
    }
}

struct Fixture {
    svm: LiteSVM,
    operator: Keypair,
    oracle: Pubkey,
}

impl Fixture {
    fn new() -> Self {
        let operator = Keypair::new();
        let oracle = Pubkey::find_program_address(&[b"oracle"], &timba::id()).0;
        let mut svm = LiteSVM::new();
        svm.add_program(
            timba::id(),
            include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/timba.so")),
        )
        .unwrap();
        svm.airdrop(&operator.pubkey(), 10_000_000_000).unwrap();
        Self {
            svm,
            operator,
            oracle,
        }
    }

    fn send(&mut self, instruction: Instruction, signers: &[&Keypair]) -> bool {
        let message = Message::new_with_blockhash(
            &[instruction],
            Some(&self.operator.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let transaction =
            VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
        self.svm.send_transaction(transaction).is_ok()
    }

    fn initialize(&mut self, oracle_config: OracleConfig) -> bool {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::InitializeOracle {
                config: oracle_config,
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
        self.send(instruction, &[&operator])
    }

    fn oracle_state(&self) -> Oracle {
        let account = self.svm.get_account(&self.oracle).unwrap();
        Oracle::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    fn update(&mut self, oracle_config: OracleConfig) -> bool {
        let instruction = Instruction::new_with_bytes(
            timba::id(),
            &timba::instruction::UpdateOracle {
                config: oracle_config,
            }
            .data(),
            timba::accounts::UpdateOracle {
                oracle: self.oracle,
                old_oracle_operator: self.operator.pubkey(),
                new_oracle_operator: self.operator.pubkey(),
            }
            .to_account_metas(None),
        );
        let operator = self.operator.insecure_clone();
        self.send(instruction, &[&operator])
    }
}

#[test]
fn initializes_oracle_and_persists_configuration() {
    let mut fixture = Fixture::new();
    let expected = config();
    assert!(fixture.initialize(expected.clone()));
    let oracle = fixture.oracle_state();
    assert_eq!(oracle.operator, fixture.operator.pubkey());
    assert_eq!(oracle.fee_percentage, expected.fee_percentage);
    assert_eq!(oracle.oracle_buffer_time, expected.oracle_buffer_time);
    assert_eq!(oracle.max_tickets, expected.max_tickets);
    assert_eq!(oracle.max_timeout, expected.max_timeout);
    assert_eq!(oracle.min_timeout, expected.min_timeout);
}

#[test]
fn rejects_invalid_oracle_configurations() {
    let invalid = [
        OracleConfig {
            fee_percentage: 11,
            ..config()
        },
        OracleConfig {
            oracle_buffer_time: 0,
            ..config()
        },
        OracleConfig {
            max_tickets: 0,
            ..config()
        },
        OracleConfig {
            max_timeout: 4,
            min_timeout: 5,
            ..config()
        },
    ];
    for oracle_config in invalid {
        let mut fixture = Fixture::new();
        assert!(!fixture.initialize(oracle_config));
        assert!(fixture.svm.get_account(&fixture.oracle).is_none());
    }
}

#[test]
fn rejects_invalid_updates_without_mutating_oracle() {
    let mut fixture = Fixture::new();
    assert!(fixture.initialize(config()));
    let invalid = [
        OracleConfig {
            fee_percentage: 11,
            ..config()
        },
        OracleConfig {
            oracle_buffer_time: 0,
            ..config()
        },
        OracleConfig {
            max_tickets: 0,
            ..config()
        },
        OracleConfig {
            max_timeout: 4,
            min_timeout: 5,
            ..config()
        },
    ];
    for oracle_config in invalid {
        assert!(!fixture.update(oracle_config));
    }
    let state = fixture.oracle_state();
    assert_eq!(state.fee_percentage, config().fee_percentage);
    assert_eq!(state.oracle_buffer_time, config().oracle_buffer_time);
    assert_eq!(state.max_tickets, config().max_tickets);
    assert_eq!(state.max_timeout, config().max_timeout);
    assert_eq!(state.min_timeout, config().min_timeout);
}
