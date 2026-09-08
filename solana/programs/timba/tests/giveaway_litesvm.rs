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

fn config(amount: u64, max_tickets: u32, min_tickets: u32, timeout: u64) -> GameConfig {
    GameConfig {
        game_type: GameType::Giveaway,
        amount,
        max_tickets,
        min_tickets,
        timeout,
        is_private: false,
    }
}

#[test]
fn initialization_requires_prize_and_unused_close_refunds_it() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (poor_creator, poor_ata) = fixture.empty_player(token.mint.pubkey());
    let (failed_game, instruction) = fixture.initialize_game_instruction(
        &token,
        poor_creator.pubkey(),
        poor_ata,
        config(5_000, 2, 1, 30),
        [37; 32],
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &poor_creator]));
    assert!(fixture.svm.get_account(&failed_game).is_none());

    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 5_000);
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        config(5_000, 2, 1, 30),
        [38; 32],
    );
    assert_eq!(fixture.token_balance(creator_ata), 0);
    assert_eq!(fixture.token_balance(token.vault_ata), 5_000);
    assert!(fixture.close_game(&token, game, &creator, creator_ata));
    assert_eq!(fixture.token_balance(creator_ata), 5_000);
}

#[test]
fn underfilled_giveaway_with_participant_closes_only_after_timeout() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 5_000);
    let (participant, participant_ata) = fixture.empty_player(token.mint.pubkey());
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        config(5_000, 3, 2, 30),
        [39; 32],
    );
    assert!(fixture.join_game(&token, game, &participant, participant_ata));
    assert!(!fixture.close_game(&token, game, &creator, creator_ata));

    let game_state = state(&fixture, game);
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (game_state.created_at + game_state.timeout) as i64;
    fixture.svm.set_sysvar(&clock);

    assert!(fixture.close_game(&token, game, &creator, creator_ata));
    assert_eq!(fixture.token_balance(creator_ata), 5_000);
}

#[test]
fn ready_giveaway_blocks_close_until_buffer_then_refunds_full_prize() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 5_000);
    let (participant, participant_ata) = fixture.empty_player(token.mint.pubkey());
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        config(5_000, 1, 1, 4),
        [40; 32],
    );
    assert!(fixture.join_game(&token, game, &participant, participant_ata));
    assert!(!fixture.close_game(&token, game, &creator, creator_ata));
    let game_state = state(&fixture, game);
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (game_state.created_at + game_state.timeout + 5) as i64;
    fixture.svm.set_sysvar(&clock);
    assert!(fixture.close_game(&token, game, &creator, creator_ata));
    assert_eq!(fixture.token_balance(creator_ata), 5_000);
}

#[test]
fn giveaway_completion_pays_prize_minus_fee_without_player_funds() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (participant, participant_ata) = fixture.empty_player(token.mint.pubkey());
    let secret = [41; 32];
    let random_hash = hash(&secret).to_bytes();
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        config(10_000, 1, 1, 30),
        random_hash,
    );
    assert!(fixture.join_game(&token, game, &participant, participant_ata));
    assert!(fixture.complete_game(
        &token,
        game,
        random_hash,
        secret,
        0,
        participant.pubkey(),
        participant_ata,
        creator.pubkey(),
    ));
    assert_eq!(fixture.token_balance(participant_ata), 9_500);
    let recipient_ata =
        fixture.associated_token_address(fixture.operator.pubkey(), token.mint.pubkey());
    assert_eq!(fixture.token_balance(recipient_ata), 500);
    assert_eq!(fixture.token_balance(token.vault_ata), 0);
}

#[test]
fn single_player_giveaway_stays_committed_and_completes_after_timeout() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (participant, participant_ata) = fixture.empty_player(token.mint.pubkey());
    let secret = [42; 32];
    let random_hash = hash(&secret).to_bytes();
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        config(10_000, 3, 1, 4),
        random_hash,
    );
    assert!(fixture.join_game(&token, game, &participant, participant_ata));
    let before = state(&fixture, game);
    assert_eq!(before.total_amount, 10_000);
    assert!(!fixture.unjoin_game(&token, game, &participant, participant_ata));
    assert_eq!(state(&fixture, game).total_amount, 10_000);
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (before.created_at + before.timeout) as i64;
    fixture.svm.set_sysvar(&clock);
    assert!(fixture.complete_game(
        &token,
        game,
        random_hash,
        secret,
        0,
        participant.pubkey(),
        participant_ata,
        creator.pubkey(),
    ));
    assert_eq!(fixture.token_balance(participant_ata), 9_500);
}
use timba_test_harness as timba;
