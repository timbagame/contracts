mod common;

use {
    anchor_lang::{prelude::Clock, AccountDeserialize},
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{
        state::{Game, GameType},
        GameConfig,
    },
};

fn game_state(fixture: &common::TimbaFixture, game: anchor_lang::prelude::Pubkey) -> Game {
    let account = fixture.svm.get_account(&game).unwrap();
    Game::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn full_game_blocks_unjoin_until_exact_buffer_expiry() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (first, first_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret_key = [9; 32];
    let random_hash = hash(&secret_key).to_bytes();
    let game = fixture.initialize_game(
        &token,
        &first,
        first_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 4,
            is_private: false,
        },
        random_hash,
    );
    assert!(fixture.join_game(&token, game, &first, first_ata));
    assert!(fixture.join_game(&token, game, &second, second_ata));
    let state = game_state(&fixture, game);
    assert_eq!(state.tickets_count, 2);
    assert!(!fixture.unjoin_game(&token, game, &first, first_ata));

    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (state.created_at + state.timeout + 5) as i64;
    fixture.svm.set_sysvar(&clock);
    let winner_index = state.calculate_winner_index(secret_key).unwrap();
    let (winner, winner_ata) = if winner_index == 0 {
        (first.pubkey(), first_ata)
    } else {
        (second.pubkey(), second_ata)
    };
    assert!(!fixture.complete_game(
        &token,
        game,
        random_hash,
        secret_key,
        winner_index,
        winner,
        winner_ata,
        first.pubkey(),
    ));
    assert!(fixture.unjoin_game(&token, game, &first, first_ata));
    let state = game_state(&fixture, game);
    assert_eq!(state.tickets_count, 1);
    assert_eq!(state.total_amount, 1_000);
    assert!(fixture.unjoin_game(&token, game, &second, second_ata));
    assert_eq!(game_state(&fixture, game).tickets_count, 0);
}

#[test]
fn underfilled_game_blocks_unjoin_until_timeout() {
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
        [10; 32],
    );
    assert!(fixture.join_game(&token, game, &player, player_ata));
    assert!(!fixture.unjoin_game(&token, game, &player, player_ata));

    let state = game_state(&fixture, game);
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (state.created_at + state.timeout) as i64;
    fixture.svm.set_sysvar(&clock);

    assert!(fixture.unjoin_game(&token, game, &player, player_ata));
    assert_eq!(game_state(&fixture, game).tickets_count, 0);
}
use timba_test_harness as timba;
