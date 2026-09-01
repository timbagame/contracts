mod common;

use {
    anchor_lang::{
        prelude::Clock, solana_program::instruction::Instruction, AccountDeserialize, Event,
        InstructionData, ToAccountMetas,
    },
    base64::{engine::general_purpose::STANDARD, Engine},
    litesvm::types::TransactionMetadata,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{
        events::{
            GameClosed, GameCompleted, GameInitialized, OracleUpdated, PlayerJoined,
            PlayerUnjoined, TokenInitialized,
        },
        state::{Game, GameType},
        GameConfig, OracleConfig,
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

#[test]
fn emits_token_and_oracle_configuration_events() {
    let mut fixture = common::TimbaFixture::new();
    let mint = fixture.create_mint();
    let token = fixture.uninitialized_token_fixture(mint);
    let init = fixture.initialize_token_instruction(&token);
    let operator = fixture.operator.insecure_clone();
    let metadata = fixture.send_result(&[init], &[&operator]).unwrap();
    let initialized: TokenInitialized = event(&metadata);
    assert_eq!(initialized.token_mint, token.mint.pubkey());

    let new_operator = solana_keypair::Keypair::new();
    fixture
        .svm
        .airdrop(&new_operator.pubkey(), 1_000_000_000)
        .unwrap();
    let update = Instruction::new_with_bytes(
        timba::id(),
        &timba::instruction::UpdateOracle {
            config: OracleConfig {
                fee_percentage: 7,
                fee_recipient: new_operator.pubkey(),
                oracle_buffer_time: 6,
                max_tickets: 1_000,
                max_timeout: 1_000,
                min_timeout: 2,
            },
        }
        .data(),
        timba::accounts::UpdateOracle {
            oracle: fixture.oracle,
            old_oracle_operator: fixture.operator.pubkey(),
            new_oracle_operator: new_operator.pubkey(),
        }
        .to_account_metas(None),
    );
    let operator = fixture.operator.insecure_clone();
    let metadata = fixture
        .send_result(&[update], &[&operator, &new_operator])
        .unwrap();
    let updated: OracleUpdated = event(&metadata);
    assert_eq!(updated.old_operator, fixture.operator.pubkey());
    assert_eq!(updated.new_operator, new_operator.pubkey());
    assert_eq!(updated.fee_percentage, 7);
    assert_eq!(updated.fee_recipient, new_operator.pubkey());
    assert_eq!(updated.oracle_buffer_time, 6);
}

#[test]
fn emits_initialize_join_unjoin_and_close_events() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (third, third_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let config = GameConfig {
        game_type: GameType::Coinflip,
        amount: 1_000,
        max_tickets: 3,
        min_tickets: 2,
        timeout: 30,
        is_private: false,
    };
    let (game, initialize) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        config,
        [50; 32],
    );
    let payer = fixture.operator.insecure_clone();
    let metadata = fixture
        .send_result(&[initialize], &[&payer, &creator])
        .unwrap();
    let initialized: GameInitialized = event(&metadata);
    assert_eq!(initialized.game_key, game);
    assert_eq!(initialized.creator, creator.pubkey());
    assert_eq!(initialized.ticket_amount, 1_000);
    assert_eq!(initialized.max_tickets, 3);
    assert_eq!(initialized.fee_percentage, 5);

    let join = fixture.join_instruction(&token, game, creator.pubkey(), creator_ata);
    let payer = fixture.operator.insecure_clone();
    let metadata = fixture.send_result(&[join], &[&payer, &creator]).unwrap();
    let joined: PlayerJoined = event(&metadata);
    assert_eq!(joined.game_key, game);
    assert_eq!(joined.player, creator.pubkey());
    assert_eq!(joined.ticket_index, 0);
    assert_eq!(joined.tickets_count, 1);
    assert_eq!(joined.total_amount, 1_000);

    let second_join = fixture.join_instruction(&token, game, second.pubkey(), second_ata);
    let payer = fixture.operator.insecure_clone();
    assert!(fixture.send(&[second_join], &[&payer, &second]));
    let third_join = fixture.join_instruction(&token, game, third.pubkey(), third_ata);
    let payer = fixture.operator.insecure_clone();
    assert!(fixture.send(&[third_join], &[&payer, &third]));
    let account = fixture.svm.get_account(&game).unwrap();
    let game_state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = (game_state.created_at + game_state.timeout + 5) as i64;
    fixture.svm.set_sysvar(&clock);

    let unjoin =
        fixture.unjoin_instruction(&token, game, second.pubkey(), second.pubkey(), second_ata);
    let payer = fixture.operator.insecure_clone();
    let metadata = fixture.send_result(&[unjoin], &[&payer, &second]).unwrap();
    let unjoined: PlayerUnjoined = event(&metadata);
    assert_eq!(unjoined.player, second.pubkey());
    assert_eq!(unjoined.ticket_index, 1);
    assert_eq!(unjoined.moved_participant, Some(third.pubkey()));
    assert_eq!(unjoined.tickets_count, 2);
    assert_eq!(unjoined.total_amount, 2_000);

    assert!(fixture.unjoin_game(&token, game, &creator, creator_ata));
    assert!(fixture.unjoin_game(&token, game, &third, third_ata));

    let close = fixture.close_game_instruction(&token, game, creator.pubkey(), creator_ata);
    let payer = fixture.operator.insecure_clone();
    let metadata = fixture.send_result(&[close], &[&payer, &creator]).unwrap();
    let closed: GameClosed = event(&metadata);
    assert_eq!(closed.game_key, game);
}

#[test]
fn emits_completion_event_for_direct_fee_settlement() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [51; 32];
    let random_hash = hash(&secret).to_bytes();
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
        random_hash,
    );
    assert!(fixture.join_game(&token, game, &creator, creator_ata));
    assert!(fixture.join_game(&token, game, &second, second_ata));
    let account = fixture.svm.get_account(&game).unwrap();
    let game_state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    let winner_index = game_state.calculate_winner_index(secret).unwrap();
    let (winner, winner_ata) = if winner_index == 0 {
        (creator.pubkey(), creator_ata)
    } else {
        (second.pubkey(), second_ata)
    };
    let complete = fixture.complete_instruction(
        &token,
        game,
        random_hash,
        secret,
        winner_index,
        winner,
        winner_ata,
        creator.pubkey(),
        fixture.operator.pubkey(),
    );
    let operator = fixture.operator.insecure_clone();
    let metadata = fixture.send_result(&[complete], &[&operator]).unwrap();
    let completed: GameCompleted = event(&metadata);
    assert_eq!(completed.game_key, game);
    assert_eq!(completed.winner, winner);
    assert_eq!(completed.winner_amount, 1_900);
    assert_eq!(completed.fee_amount, 100);
    let recipient_ata =
        fixture.associated_token_address(fixture.operator.pubkey(), token.mint.pubkey());
    assert_eq!(fixture.token_balance(recipient_ata), 100);
}
use timba_test_harness as timba;
