mod common;

use {
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{state::GameType, GameConfig},
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

    assert!(!fixture.join_game(&wrong_token, game, &creator, creator_wrong_ata));
    assert!(fixture.join_game(&expected_token, game, &creator, creator_ata));
    assert!(!fixture.complete_game(
        &wrong_token,
        game,
        random_hash,
        secret,
        0,
        creator.pubkey(),
        creator_wrong_ata,
        creator.pubkey(),
    ));
    let instruction = fixture.unjoin_instruction(
        &wrong_token,
        game,
        creator.pubkey(),
        creator.pubkey(),
        creator_wrong_ata,
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &creator]));
}
