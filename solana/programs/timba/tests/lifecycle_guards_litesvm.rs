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

fn state(fixture: &common::TimbaFixture, game: anchor_lang::prelude::Pubkey) -> Game {
    let account = fixture.svm.get_account(&game).unwrap();
    Game::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn rejects_join_at_and_after_timeout_without_sleeping() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (player, player_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 3,
            min_tickets: 2,
            timeout: 2,
            is_private: false,
        },
        [11; 32],
    );
    let game_state = state(&fixture, game);
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (game_state.created_at + game_state.timeout) as i64;
    fixture.svm.set_sysvar(&clock);
    assert!(!fixture.join_game(&token, game, &player, player_ata));
    assert_eq!(state(&fixture, game).tickets_count, 0);
}

#[test]
fn rejects_completion_before_minimum_participants_join() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (player, player_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [12; 32];
    let random_hash = hash(&secret).to_bytes();
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 4,
            min_tickets: 3,
            timeout: 30,
            is_private: false,
        },
        random_hash,
    );
    assert!(fixture.join_game(&token, game, &creator, creator_ata));
    assert!(fixture.join_game(&token, game, &player, player_ata));
    let game_state = state(&fixture, game);
    let winner_index = game_state.calculate_winner_index(secret).unwrap();
    let (winner, winner_ata) = if winner_index == 0 {
        (creator.pubkey(), creator_ata)
    } else {
        (player.pubkey(), player_ata)
    };
    assert!(!fixture.complete_game(
        &token,
        game,
        random_hash,
        secret,
        winner_index,
        winner,
        winner_ata,
        creator.pubkey(),
    ));
    assert_eq!(state(&fixture, game).total_amount, 2_000);
}
use timba_test_harness as timba;
