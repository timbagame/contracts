mod common;

use timba_test_harness as timba;

use {
    anchor_lang::{prelude::Clock, AccountDeserialize, Event},
    base64::{engine::general_purpose::STANDARD, Engine},
    litesvm::types::TransactionMetadata,
    solana_keypair::Keypair,
    solana_signer::Signer,
    timba::{
        events::OperatorGameClosed,
        state::{Game, GameType, Oracle},
        GameConfig,
    },
};

fn event<E: Event>(metadata: &TransactionMetadata) -> E {
    metadata
        .logs
        .iter()
        .filter_map(|log| log.strip_prefix("Program data: "))
        .filter_map(|encoded| STANDARD.decode(encoded).ok())
        .find_map(|data| {
            data.strip_prefix(E::DISCRIMINATOR)
                .and_then(|mut payload| E::deserialize(&mut payload).ok())
        })
        .expect("expected event in transaction logs")
}

fn game_state(fixture: &common::TimbaFixture, game: anchor_lang::prelude::Pubkey) -> Game {
    let account = fixture.svm.get_account(&game).unwrap();
    Game::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn cleanup_deadline(fixture: &common::TimbaFixture, game: anchor_lang::prelude::Pubkey) -> u64 {
    let game = game_state(fixture, game);
    let oracle_account = fixture.svm.get_account(&fixture.oracle).unwrap();
    let oracle = Oracle::try_deserialize(&mut oracle_account.data.as_slice()).unwrap();
    game.created_at + game.timeout + oracle.oracle_buffer_time
}

fn set_time(fixture: &mut common::TimbaFixture, timestamp: u64) {
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = timestamp as i64;
    fixture.svm.set_sysvar(&clock);
}

fn coinflip_config() -> GameConfig {
    GameConfig {
        game_type: GameType::Coinflip,
        amount: 1_000,
        max_tickets: 2,
        min_tickets: 2,
        timeout: 30,
        is_private: false,
    }
}

#[test]
fn operator_cleanup_requires_authorization_empty_game_and_deadline() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let empty_game =
        fixture.initialize_game(&token, &creator, creator_ata, coinflip_config(), [60; 32]);
    let empty_game_rent = fixture.svm.get_account(&empty_game).unwrap().lamports;

    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    let wrong_operator = fixture.operator_close_game_instruction(
        &token,
        empty_game,
        creator.pubkey(),
        creator_ata,
        outsider.pubkey(),
    );
    let payer = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[wrong_operator], &[&payer, &outsider]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::UnauthorizedOperator)
    );

    let early = fixture.operator_close_game_instruction(
        &token,
        empty_game,
        creator.pubkey(),
        creator_ata,
        fixture.operator.pubkey(),
    );
    let operator = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[early], &[&operator]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::GameCleanupNotAvailable)
    );

    let active_game =
        fixture.initialize_game(&token, &creator, creator_ata, coinflip_config(), [61; 32]);
    assert!(fixture.join_game(&token, active_game, &creator, creator_ata));
    let active_deadline = cleanup_deadline(&fixture, active_game);
    set_time(&mut fixture, active_deadline);
    let active = fixture.operator_close_game_instruction(
        &token,
        active_game,
        creator.pubkey(),
        creator_ata,
        fixture.operator.pubkey(),
    );
    let operator = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[active], &[&operator]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::GameHasActivePlayers)
    );
    assert!(fixture.svm.get_account(&active_game).is_some());

    let deadline = cleanup_deadline(&fixture, empty_game);
    set_time(&mut fixture, deadline);
    let close = fixture.operator_close_game_instruction(
        &token,
        empty_game,
        creator.pubkey(),
        creator_ata,
        fixture.operator.pubkey(),
    );
    let repeated_close = close.clone();
    let operator = fixture.operator.insecure_clone();
    let metadata = fixture.send_result(&[close], &[&operator]).unwrap();
    let closed: OperatorGameClosed = event(&metadata);
    assert_eq!(closed.game_key, empty_game);
    assert_eq!(closed.creator, creator.pubkey());
    assert_eq!(closed.operator, fixture.operator.pubkey());
    assert_eq!(closed.refunded_amount, 0);
    assert_eq!(closed.recovered_lamports, empty_game_rent);
    assert_eq!(closed.timestamp, deadline);
    assert!(fixture.svm.get_account(&empty_game).is_none());

    let operator = fixture.operator.insecure_clone();
    assert!(fixture
        .send_result(&[repeated_close], &[&operator])
        .is_err());
}

#[test]
fn operator_cleanup_refunds_empty_giveaway_to_creator() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 5_000);
    let (_outsider, outsider_ata) = fixture.empty_player(token.mint.pubkey());
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Giveaway,
            amount: 5_000,
            max_tickets: 2,
            min_tickets: 1,
            timeout: 30,
            is_private: false,
        },
        [62; 32],
    );
    assert_eq!(fixture.token_balance(creator_ata), 0);
    assert_eq!(fixture.token_balance(token.vault_ata), 5_000);
    let creator_lamports = fixture.svm.get_balance(&creator.pubkey()).unwrap();

    let deadline = cleanup_deadline(&fixture, game);
    set_time(&mut fixture, deadline);
    let wrong_destination = fixture.operator_close_game_instruction(
        &token,
        game,
        creator.pubkey(),
        outsider_ata,
        fixture.operator.pubkey(),
    );
    let operator = fixture.operator.insecure_clone();
    assert!(fixture
        .send_result(&[wrong_destination], &[&operator])
        .is_err());
    assert!(fixture.svm.get_account(&game).is_some());
    assert_eq!(fixture.token_balance(creator_ata), 0);

    let close = fixture.operator_close_game_instruction(
        &token,
        game,
        creator.pubkey(),
        creator_ata,
        fixture.operator.pubkey(),
    );
    let operator = fixture.operator.insecure_clone();
    let metadata = fixture.send_result(&[close], &[&operator]).unwrap();
    let closed: OperatorGameClosed = event(&metadata);
    assert_eq!(closed.creator, creator.pubkey());
    assert_eq!(closed.refunded_amount, 5_000);
    assert_eq!(fixture.token_balance(creator_ata), 5_000);
    assert_eq!(fixture.token_balance(token.vault_ata), 0);
    assert_eq!(
        fixture.svm.get_balance(&creator.pubkey()).unwrap(),
        creator_lamports
    );
    assert!(fixture.svm.get_account(&game).is_none());
}
