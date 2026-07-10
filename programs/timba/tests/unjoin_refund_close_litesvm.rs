mod common;

use {
    anchor_lang::{prelude::Clock, AccountDeserialize},
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

fn two_player_game() -> (
    common::TimbaFixture,
    common::TokenFixture,
    solana_keypair::Keypair,
    anchor_lang::prelude::Pubkey,
    solana_keypair::Keypair,
    anchor_lang::prelude::Pubkey,
    anchor_lang::prelude::Pubkey,
) {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 4,
            is_private: false,
        },
        [17; 32],
    );
    assert!(fixture.join_game(&token, game, &creator, creator_ata));
    assert!(fixture.join_game(&token, game, &second, second_ata));
    (
        fixture,
        token,
        creator,
        creator_ata,
        second,
        second_ata,
        game,
    )
}

#[test]
fn unjoin_refunds_exact_ticket_amount_after_buffer() {
    let (mut fixture, token, creator, creator_ata, _second, _second_ata, game) = two_player_game();
    let game_state = state(&fixture, game);
    let before = fixture.token_balance(creator_ata);
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (game_state.created_at + game_state.timeout + 5) as i64;
    fixture.svm.set_sysvar(&clock);
    assert!(fixture.unjoin_game(&token, game, &creator, creator_ata));
    assert_eq!(fixture.token_balance(creator_ata) - before, 1_000);
    assert_eq!(fixture.token_balance(token.vault_ata), 1_000);
}

#[test]
fn creator_can_remove_participant_before_minimum_is_reached() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (participant, participant_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
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
        [18; 32],
    );
    assert!(fixture.join_game(&token, game, &participant, participant_ata));
    let instruction = fixture.unjoin_instruction(
        &token,
        game,
        participant.pubkey(),
        creator.pubkey(),
        participant_ata,
    );
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.send(&[instruction], &[&operator, &creator]));
    assert_eq!(state(&fixture, game).tickets_count, 0);
    assert_eq!(fixture.token_balance(participant_ata), 10_000);
}

#[test]
fn close_is_blocked_with_players_then_succeeds_after_refunds() {
    let (mut fixture, token, creator, creator_ata, second, second_ata, game) = two_player_game();
    assert!(!fixture.close_game(&token, game, &creator, creator_ata));
    let game_state = state(&fixture, game);
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (game_state.created_at + game_state.timeout + 5) as i64;
    fixture.svm.set_sysvar(&clock);
    assert!(fixture.unjoin_game(&token, game, &creator, creator_ata));
    assert!(fixture.unjoin_game(&token, game, &second, second_ata));
    assert!(fixture.close_game(&token, game, &creator, creator_ata));
    assert!(fixture.svm.get_account(&game).is_none());
}
