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
fn non_operator_cannot_withdraw_even_zero_fees() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    let outsider_ata = fixture.create_ata(outsider.pubkey(), token.mint.pubkey());
    assert!(!fixture.withdraw_fees(&token, &outsider, outsider_ata));
}
