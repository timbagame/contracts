mod common;

use {
    solana_keypair::Keypair,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{state::GameType, GameConfig, OracleConfig},
};

fn config() -> OracleConfig {
    OracleConfig {
        fee_percentage: 5,
        oracle_buffer_time: 5,
        max_tickets: 2_048,
        max_timeout: 86_400,
        min_timeout: 1,
    }
}

#[test]
fn rotated_operator_controls_private_join_completion_and_withdrawal() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let old_operator = fixture.operator.insecure_clone();
    let new_operator = Keypair::new();
    fixture
        .svm
        .airdrop(&new_operator.pubkey(), 1_000_000_000)
        .unwrap();
    assert!(fixture.rotate_oracle(&old_operator, &new_operator, config()));

    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [49; 32];
    let random_hash = hash(&secret).to_bytes();
    let game = fixture.initialize_game_with_operator(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 30,
            is_private: true,
        },
        random_hash,
        &new_operator,
    );
    assert!(!fixture.join_game(&token, game, &creator, creator_ata));
    let wrong = fixture.join_instruction_with_operator(
        &token,
        game,
        creator.pubkey(),
        creator_ata,
        Some(old_operator.pubkey()),
    );
    let payer = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[wrong], &[&payer, &creator]));
    let first = fixture.join_instruction_with_operator(
        &token,
        game,
        creator.pubkey(),
        creator_ata,
        Some(new_operator.pubkey()),
    );
    let payer = fixture.operator.insecure_clone();
    assert!(fixture.send(&[first], &[&payer, &creator, &new_operator]));
    let second_join = fixture.join_instruction_with_operator(
        &token,
        game,
        second.pubkey(),
        second_ata,
        Some(new_operator.pubkey()),
    );
    let payer = fixture.operator.insecure_clone();
    assert!(fixture.send(&[second_join], &[&payer, &second, &new_operator]));

    let account = fixture.svm.get_account(&game).unwrap();
    let state = <timba::state::Game as anchor_lang::AccountDeserialize>::try_deserialize(
        &mut account.data.as_slice(),
    )
    .unwrap();
    let winner_index = state.calculate_winner_index(secret).unwrap();
    let (winner, winner_ata) = if winner_index == 0 {
        (creator.pubkey(), creator_ata)
    } else {
        (second.pubkey(), second_ata)
    };
    let old_completion = fixture.complete_instruction(
        &token,
        game,
        random_hash,
        secret,
        winner_index,
        winner,
        winner_ata,
        creator.pubkey(),
        old_operator.pubkey(),
    );
    let payer = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[old_completion], &[&payer]));
    let completion = fixture.complete_instruction(
        &token,
        game,
        random_hash,
        secret,
        winner_index,
        winner,
        winner_ata,
        creator.pubkey(),
        new_operator.pubkey(),
    );
    let payer = fixture.operator.insecure_clone();
    assert!(fixture.send(&[completion], &[&payer, &new_operator]));

    let new_operator_ata = fixture.create_ata(new_operator.pubkey(), token.mint.pubkey());
    let old_operator_ata = fixture.create_ata(old_operator.pubkey(), token.mint.pubkey());
    assert!(!fixture.withdraw_fees(&token, &old_operator, old_operator_ata));
    assert!(fixture.withdraw_fees(&token, &new_operator, new_operator_ata));
}
use timba_test_harness as timba;
