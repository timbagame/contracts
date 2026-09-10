mod common;

use {
    solana_signer::Signer,
    timba::{error::ErrorCode, state::GameType, GameConfig},
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
fn rejects_zero_commitment() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (game, instruction) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 60,
            is_private: false,
        },
        [0; 32],
    );

    let operator = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[instruction], &[&operator, &creator])),
        common::anchor_error(ErrorCode::InvalidCommitment)
    );
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
    rejected(coinflip(2, 2, timba::state::MAX_GAME_TIMEOUT + 1), 25);
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

#[test]
fn enforces_game_allocation_boundary() {
    for capacity in [315, 316, u32::MAX] {
        let mut fixture = common::TimbaFixture::new();
        let token = fixture.token_fixture();
        let (creator, ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
        let (game, instruction) = fixture.initialize_game_instruction(
            &token,
            creator.pubkey(),
            ata,
            GameConfig {
                game_type: GameType::Coinflip,
                amount: 1_000,
                max_tickets: capacity,
                min_tickets: 2,
                timeout: 60,
                is_private: false,
            },
            [99; 32],
        );
        let operator = fixture.operator.insecure_clone();
        let result = fixture.send_result(&[instruction], &[&operator, &creator]);
        if capacity == 315 {
            assert!(result.is_ok());
            assert_eq!(fixture.svm.get_account(&game).unwrap().data.len(), 10_210);
        } else {
            let error = result.unwrap_err();
            assert!(error
                .meta
                .logs
                .iter()
                .any(|line| line.contains("InvalidTicketsCount")));
            assert!(fixture.svm.get_account(&game).is_none());
        }
    }
}

#[test]
fn creates_game_at_maximum_duration() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    fixture.initialize_game(
        &token,
        &creator,
        ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: timba::state::MAX_GAME_TIMEOUT,
            is_private: false,
        },
        [98; 32],
    );
}
