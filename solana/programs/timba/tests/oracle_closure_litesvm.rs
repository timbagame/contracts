mod common;

use timba_test_harness as timba;

use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, Event, InstructionData,
        ToAccountMetas,
    },
    base64::{engine::general_purpose::STANDARD, Engine},
    litesvm::types::TransactionMetadata,
    solana_keypair::Keypair,
    solana_signer::Signer,
    timba::events::OracleClosed,
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
