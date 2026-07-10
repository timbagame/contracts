mod common;

use {
    anchor_lang::AccountDeserialize,
    solana_signer::Signer,
    timba::{
        error::ErrorCode,
        state::{Game, GameType},
        GameConfig,
    },
};

fn state(fixture: &common::TimbaFixture, game: anchor_lang::prelude::Pubkey) -> Game {
    let account = fixture.svm.get_account(&game).unwrap();
    Game::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn full_game_returns_game_full() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (first, first_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (third, third_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
        &first,
        first_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [57; 32],
    );
    assert!(fixture.join_game(&token, game, &first, first_ata));
    assert!(fixture.join_game(&token, game, &second, second_ata));

    let instruction = fixture.join_instruction(&token, game, third.pubkey(), third_ata);
    let operator = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[instruction], &[&operator, &third])),
        common::anchor_error(ErrorCode::GameFull)
    );
}

#[test]
fn rejects_duplicate_participant() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (player, player_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
        &player,
        player_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 3,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [13; 32],
    );
    assert!(fixture.join_game(&token, game, &player, player_ata));
    assert!(!fixture.join_game(&token, game, &player, player_ata));
    assert_eq!(state(&fixture, game).tickets_count, 1);
}

#[test]
fn transaction_with_two_final_seat_joins_is_atomic() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (first, first_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (third, third_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
        &first,
        first_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [14; 32],
    );
    assert!(fixture.join_game(&token, game, &first, first_ata));
    let instructions = [
        fixture.join_instruction(&token, game, second.pubkey(), second_ata),
        fixture.join_instruction(&token, game, third.pubkey(), third_ata),
    ];
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&instructions, &[&operator, &second, &third]));
    assert_eq!(state(&fixture, game).tickets_count, 1);
}

#[test]
fn rejects_join_with_insufficient_token_balance() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (poor_player, poor_ata) = fixture.empty_player(token.mint.pubkey());
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
        [53; 32],
    );
    assert!(!fixture.join_game(&token, game, &poor_player, poor_ata));
    assert_eq!(state(&fixture, game).tickets_count, 0);
}
