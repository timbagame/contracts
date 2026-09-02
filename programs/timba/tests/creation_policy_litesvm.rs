use timba_test_harness as timba;
mod common;

use {
    anchor_lang::AccountDeserialize,
    solana_signer::Signer,
    timba::{
        state::{Game, GameType},
        GameConfig,
    },
};

#[test]
fn operator_can_approve_any_positive_creation_amount() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 1);

    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 60,
            is_private: false,
        },
        [31; 32],
    );

    let account = fixture.svm.get_account(&game).unwrap();
    let state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(state.ticket_amount, 1);
}
