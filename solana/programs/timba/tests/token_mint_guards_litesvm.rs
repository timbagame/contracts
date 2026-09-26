mod common;

use {
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{error::ErrorCode, state::GameType, GameConfig},
};

#[test]
fn rejects_wrong_token_context_for_join_complete_and_unjoin() {
    let mut fixture = common::TimbaFixture::new();
    let expected_token = fixture.token_fixture();
    let wrong_token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(expected_token.mint.pubkey(), 10_000);
    let creator_wrong_ata = fixture.create_ata(creator.pubkey(), wrong_token.mint.pubkey());
    let secret = [29; 32];
    let random_hash = hash(&secret).to_bytes();
    let game = fixture.initialize_game(
        &expected_token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 3,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        random_hash,
    );

    // Fund the wrong-mint account so the mint guard, not the balance guard, rejects the join.
    fixture.set_token_balance(creator_wrong_ata, 10_000);
    let wrong_join =
        fixture.join_instruction(&wrong_token, game, creator.pubkey(), creator_wrong_ata);
    let operator = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[wrong_join], &[&operator, &creator])),
        common::anchor_error(ErrorCode::InvalidTokenMint)
    );
    assert!(fixture.join_game(&expected_token, game, &creator, creator_ata));
    assert_eq!(
        fixture.complete_game_error(
            &wrong_token,
            game,
            random_hash,
            secret,
            0,
            creator.pubkey(),
            creator_wrong_ata,
            creator.pubkey(),
        ),
        common::anchor_error(ErrorCode::InvalidTokenMint)
    );
    let instruction = fixture.unjoin_instruction(
        &wrong_token,
        game,
        creator.pubkey(),
        creator.pubkey(),
        creator_wrong_ata,
    );
    let operator = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[instruction], &[&operator, &creator])),
        common::anchor_error(ErrorCode::InvalidTokenMint)
    );
    assert_eq!(fixture.token_balance(creator_ata), 9_000);
    assert_eq!(fixture.token_balance(expected_token.vault_ata), 1_000);
}
use timba_test_harness as timba;
