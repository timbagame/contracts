mod common;

use {
    solana_keypair::Keypair,
    solana_signer::Signer,
    timba::{state::GameType, GameConfig},
};

#[test]
fn non_creator_cannot_close_game() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (outsider, outsider_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [47; 32],
    );
    assert!(!fixture.close_game(&token, game, &outsider, outsider_ata));
    assert!(fixture.svm.get_account(&game).is_some());
    assert!(fixture.close_game(&token, game, &creator, creator_ata));
}

#[test]
fn non_operator_cannot_approve_game_initialization() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let outsider = Keypair::new();
    let random_hash = [48; 32];
    let (game, mut instruction) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        random_hash,
    );

    let operator_key = fixture.operator.pubkey();
    let oracle_operator = instruction
        .accounts
        .iter_mut()
        .find(|account| account.pubkey == operator_key && account.is_signer)
        .expect("initialize_game must require the oracle operator signer");
    oracle_operator.pubkey = outsider.pubkey();

    let operator = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[instruction], &[&operator, &creator, &outsider]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::UnauthorizedOperator)
    );
    assert!(fixture.svm.get_account(&game).is_none());
}
use timba_test_harness as timba;
