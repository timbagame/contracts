mod common;

use {
    solana_signer::Signer,
    timba::{state::GameType, GameConfig},
};

fn rejected(config: GameConfig, seed: u8) {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (game, instruction) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        config,
        [seed; 32],
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &creator]));
    assert!(fixture.svm.get_account(&game).is_none());
}

#[test]
fn rejects_zero_amount() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (game, instruction) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 0,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 60,
            is_private: false,
        },
        [28; 32],
    );

    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &creator]));
    assert!(fixture.svm.get_account(&game).is_none());
}

#[test]
fn rejects_invalid_coinflip_ticket_and_timeout_configuration() {
    let coinflip = |max_tickets, min_tickets, timeout| GameConfig {
        game_type: GameType::Coinflip,
        amount: 1_000,
        max_tickets,
        min_tickets,
        timeout,
        is_private: false,
    };
    rejected(coinflip(1, 1, 60), 21);
    rejected(coinflip(3, 4, 60), 22);
    rejected(coinflip(2_049, 2, 60), 23);
    rejected(coinflip(2, 2, 0), 24);
    rejected(coinflip(2, 2, 86_401), 25);
}

#[test]
fn rejects_invalid_giveaway_ticket_count() {
    rejected(
        GameConfig {
            game_type: GameType::Giveaway,
            amount: 5_000,
            max_tickets: 3,
            min_tickets: 0,
            timeout: 60,
            is_private: false,
        },
        26,
    );
}
use timba_test_harness as timba;
