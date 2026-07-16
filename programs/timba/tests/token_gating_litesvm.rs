mod common;

use {
    anchor_lang::AccountDeserialize,
    solana_signer::Signer,
    timba::{
        state::{Game, GameType},
        GameConfig, TokenConfig,
    },
};

fn config(amount: u64) -> GameConfig {
    GameConfig {
        game_type: GameType::Coinflip,
        amount,
        max_tickets: 3,
        min_tickets: 2,
        timeout: 60,
        is_private: false,
    }
}

#[test]
fn disabled_token_blocks_game_initialization() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 20_000);
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_token(
        &token,
        &operator,
        TokenConfig {
            min_amount: 1_000,
            enabled: false
        }
    ));
    let (game, instruction) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        config(1_000),
        [31; 32],
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &creator]));
    assert!(fixture.svm.get_account(&game).is_none());
}

#[test]
fn minimum_amount_is_checked_at_initialization_not_join() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 20_000);
    let (player, player_ata) = fixture.funded_player(token.mint.pubkey(), 20_000);
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_token(
        &token,
        &operator,
        TokenConfig {
            min_amount: 10_000,
            enabled: true
        }
    ));
    let (_game, instruction) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        config(1_000),
        [32; 32],
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &creator]));

    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_token(
        &token,
        &operator,
        TokenConfig {
            min_amount: 1_000,
            enabled: true
        }
    ));
    let game = fixture.initialize_game(&token, &creator, creator_ata, config(1_000), [33; 32]);
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_token(
        &token,
        &operator,
        TokenConfig {
            min_amount: 10_000,
            enabled: true
        }
    ));
    assert!(fixture.join_game(&token, game, &player, player_ata));
    let account = fixture.svm.get_account(&game).unwrap();
    let state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(state.tickets_count, 1);
}

#[test]
fn disabling_token_blocks_additional_joins() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 20_000);
    let (first, first_ata) = fixture.funded_player(token.mint.pubkey(), 20_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 20_000);
    let game = fixture.initialize_game(&token, &creator, creator_ata, config(2_000), [34; 32]);
    assert!(fixture.join_game(&token, game, &creator, creator_ata));
    assert!(fixture.join_game(&token, game, &first, first_ata));
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_token(
        &token,
        &operator,
        TokenConfig {
            min_amount: 1_000,
            enabled: false
        }
    ));
    assert!(!fixture.join_game(&token, game, &second, second_ata));
}
use timba_test_harness as timba;
