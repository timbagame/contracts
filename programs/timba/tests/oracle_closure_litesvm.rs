mod common;

use timba_test_harness as timba;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, Discriminator, Event, InstructionData, ToAccountMetas,
    },
    base64::{engine::general_purpose::STANDARD, Engine},
    litesvm::types::TransactionMetadata,
    solana_keypair::Keypair,
    solana_signer::Signer,
    timba::{
        events::{LegacyOracleClosed, OracleClosed},
        state::{Oracle, LEGACY_ORACLE_SIZE, ORACLE_SIZE},
        OracleConfig,
    },
};

fn event<E: Event>(metadata: &TransactionMetadata) -> E {
    metadata
        .logs
        .iter()
        .filter_map(|log| log.strip_prefix("Program data: "))
        .filter_map(|encoded| STANDARD.decode(encoded).ok())
        .find_map(|data| {
            data.strip_prefix(E::DISCRIMINATOR)
                .and_then(|mut payload| E::deserialize(&mut payload).ok())
        })
        .expect("expected event in transaction logs")
}

fn close_oracle_instruction(
    fixture: &common::TimbaFixture,
    oracle_operator: Pubkey,
    upgrade_authority: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        timba::id(),
        &timba::instruction::CloseOracle {}.data(),
        timba::accounts::CloseOracle {
            oracle: fixture.oracle,
            oracle_operator,
            upgrade_authority,
            program: timba::id(),
            program_data: fixture.program_data,
        }
        .to_account_metas(None),
    )
}

fn close_legacy_oracle_instruction(
    fixture: &common::TimbaFixture,
    oracle_operator: Pubkey,
    upgrade_authority: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        timba::id(),
        &timba::instruction::CloseLegacyOracle {}.data(),
        timba::accounts::CloseLegacyOracle {
            oracle: fixture.oracle,
            oracle_operator,
            upgrade_authority,
            program: timba::id(),
            program_data: fixture.program_data,
        }
        .to_account_metas(None),
    )
}

fn initialize_oracle_instruction(
    fixture: &common::TimbaFixture,
    upgrade_authority: Pubkey,
    config: OracleConfig,
) -> Instruction {
    Instruction::new_with_bytes(
        timba::id(),
        &timba::instruction::InitializeOracle { config }.data(),
        timba::accounts::InitializeOracle {
            oracle: fixture.oracle,
            oracle_operator: fixture.operator.pubkey(),
            upgrade_authority,
            program: timba::id(),
            program_data: fixture.program_data,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn legacy_oracle_data(operator: Pubkey) -> Vec<u8> {
    let mut data = vec![0; LEGACY_ORACLE_SIZE];
    data[..8].copy_from_slice(Oracle::DISCRIMINATOR);
    data[8..40].copy_from_slice(operator.as_ref());
    data[40] = 5;
    data[41..49].copy_from_slice(&5_u64.to_le_bytes());
    data[49..53].copy_from_slice(&2_048_u32.to_le_bytes());
    data[53..61].copy_from_slice(&86_400_u64.to_le_bytes());
    data[61..69].copy_from_slice(&1_u64.to_le_bytes());
    data
}

fn install_legacy_oracle(fixture: &mut common::TimbaFixture) {
    let mut account = fixture.svm.get_account(&fixture.oracle).unwrap();
    account.data = legacy_oracle_data(fixture.operator.pubkey());
    fixture.svm.set_account(fixture.oracle, account).unwrap();
}

fn distinct_upgrade_authority(fixture: &mut common::TimbaFixture) -> Keypair {
    let upgrade_authority = Keypair::new();
    fixture
        .svm
        .airdrop(&upgrade_authority.pubkey(), 1_000_000_000)
        .unwrap();
    common::set_program_upgrade_authority(
        &mut fixture.svm,
        timba::id(),
        upgrade_authority.pubkey(),
    );
    upgrade_authority
}

#[test]
fn current_close_requires_operator_and_upgrade_authority() {
    let mut fixture = common::TimbaFixture::new();
    let upgrade_authority = distinct_upgrade_authority(&mut fixture);
    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();

    let wrong_operator =
        close_oracle_instruction(&fixture, outsider.pubkey(), upgrade_authority.pubkey());
    let payer = fixture.operator.insecure_clone();
    assert!(fixture
        .send_result(&[wrong_operator], &[&payer, &outsider, &upgrade_authority])
        .is_err());
    assert!(fixture.svm.get_account(&fixture.oracle).is_some());

    let wrong_authority =
        close_oracle_instruction(&fixture, fixture.operator.pubkey(), outsider.pubkey());
    let payer = fixture.operator.insecure_clone();
    assert!(fixture
        .send_result(&[wrong_authority], &[&payer, &outsider])
        .is_err());
    assert!(fixture.svm.get_account(&fixture.oracle).is_some());

    let close = close_oracle_instruction(
        &fixture,
        fixture.operator.pubkey(),
        upgrade_authority.pubkey(),
    );
    let payer = fixture.operator.insecure_clone();
    let metadata = fixture
        .send_result(&[close], &[&payer, &upgrade_authority])
        .unwrap();
    let closed: OracleClosed = event(&metadata);
    assert_eq!(closed.operator, fixture.operator.pubkey());
    assert!(fixture.svm.get_account(&fixture.oracle).is_none());
}

#[test]
fn legacy_close_rejects_current_oracle_layout() {
    let mut fixture = common::TimbaFixture::new();
    let close = close_legacy_oracle_instruction(
        &fixture,
        fixture.operator.pubkey(),
        fixture.operator.pubkey(),
    );
    let operator = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[close], &[&operator]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::InvalidLegacyOracle)
    );
    assert_eq!(
        fixture.svm.get_account(&fixture.oracle).unwrap().data.len(),
        ORACLE_SIZE
    );
}

#[test]
fn legacy_close_requires_both_authorities_and_exact_discriminator() {
    let mut fixture = common::TimbaFixture::new();
    install_legacy_oracle(&mut fixture);
    let upgrade_authority = distinct_upgrade_authority(&mut fixture);
    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();

    let wrong_operator =
        close_legacy_oracle_instruction(&fixture, outsider.pubkey(), upgrade_authority.pubkey());
    let payer = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[wrong_operator], &[&payer, &outsider, &upgrade_authority]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::UnauthorizedOperator)
    );

    let wrong_authority =
        close_legacy_oracle_instruction(&fixture, fixture.operator.pubkey(), outsider.pubkey());
    let payer = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[wrong_authority], &[&payer, &outsider]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::UnauthorizedOperator)
    );

    let mut account = fixture.svm.get_account(&fixture.oracle).unwrap();
    account.data[0] ^= 0xff;
    fixture.svm.set_account(fixture.oracle, account).unwrap();
    let malformed = close_legacy_oracle_instruction(
        &fixture,
        fixture.operator.pubkey(),
        upgrade_authority.pubkey(),
    );
    let payer = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[malformed], &[&payer, &upgrade_authority]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::InvalidLegacyOracle)
    );
    assert!(fixture.svm.get_account(&fixture.oracle).is_some());
}

#[test]
fn legacy_close_and_current_initialize_are_atomic() {
    let mut fixture = common::TimbaFixture::new();
    install_legacy_oracle(&mut fixture);
    let upgrade_authority = distinct_upgrade_authority(&mut fixture);
    let new_config = OracleConfig {
        fee_percentage: 7,
        fee_recipient: Pubkey::new_from_array([9; 32]),
        oracle_buffer_time: 10,
        max_tickets: 4_096,
        max_timeout: 172_800,
        min_timeout: 2,
    };
    let close = close_legacy_oracle_instruction(
        &fixture,
        fixture.operator.pubkey(),
        upgrade_authority.pubkey(),
    );
    let initialize =
        initialize_oracle_instruction(&fixture, upgrade_authority.pubkey(), new_config.clone());
    let operator = fixture.operator.insecure_clone();
    let metadata = fixture
        .send_result(&[close, initialize], &[&operator, &upgrade_authority])
        .unwrap();

    let closed: LegacyOracleClosed = event(&metadata);
    assert_eq!(closed.operator, fixture.operator.pubkey());
    let account = fixture.svm.get_account(&fixture.oracle).unwrap();
    assert_eq!(account.data.len(), ORACLE_SIZE);
    let oracle = Oracle::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(oracle.operator, fixture.operator.pubkey());
    assert_eq!(oracle.fee_percentage, new_config.fee_percentage);
    assert_eq!(oracle.fee_recipient, new_config.fee_recipient);
    assert_eq!(oracle.oracle_buffer_time, new_config.oracle_buffer_time);
    assert_eq!(oracle.max_tickets, new_config.max_tickets);
    assert_eq!(oracle.max_timeout, new_config.max_timeout);
    assert_eq!(oracle.min_timeout, new_config.min_timeout);
}
