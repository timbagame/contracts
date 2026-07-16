mod common;

use {
    anchor_lang::AccountDeserialize,
    solana_keypair::Keypair,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{
        state::{Game, GameToken, GameType},
        GameConfig, OracleConfig, TokenConfig,
    },
};

fn token_state(fixture: &common::TimbaFixture, token: &common::TokenFixture) -> GameToken {
    let account = fixture.svm.get_account(&token.game_token).unwrap();
    GameToken::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn completion_accrues_exact_fee_and_withdraws_it() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [35; 32];
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
    let before = fixture.token_balance(winner_ata);
    assert!(fixture.complete_game(
        &token,
        game,
        random_hash,
        secret,
        winner_index,
        winner,
        winner_ata,
        creator.pubkey(),
    ));
    assert_eq!(fixture.token_balance(winner_ata) - before, 1_900);
    assert_eq!(token_state(&fixture, &token).fee_amount, 100);
    let operator_ata = fixture.create_ata(fixture.operator.pubkey(), token.mint.pubkey());
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.withdraw_fees(&token, &operator, operator_ata));
    assert_eq!(fixture.token_balance(operator_ata), 100);
    assert_eq!(token_state(&fixture, &token).fee_amount, 0);
}

#[test]
fn near_u64_max_fee_is_exact_and_withdrawable_while_disabled() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let prize = 18_446_744_073_709_500_000_u64;
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), prize);
    let participant = Keypair::new();
    fixture
        .svm
        .airdrop(&participant.pubkey(), 1_000_000_000)
        .unwrap();
    let participant_ata = fixture.create_ata(participant.pubkey(), token.mint.pubkey());
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_oracle(
        &operator,
        OracleConfig {
            fee_percentage: 10,
            oracle_buffer_time: 5,
            max_tickets: 2_048,
            max_timeout: 86_400,
            min_timeout: 1,
        },
    ));
    let secret = [36; 32];
    let random_hash = hash(&secret).to_bytes();
    let game = fixture.initialize_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Giveaway,
            amount: prize,
            max_tickets: 1,
            min_tickets: 1,
            timeout: 30,
            is_private: false,
        },
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
    let fee = prize / 10;
    assert_eq!(fixture.token_balance(participant_ata), prize - fee);
    assert_eq!(token_state(&fixture, &token).fee_amount, fee);
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_token(
        &token,
        &operator,
        TokenConfig {
            min_amount: 1_000,
            enabled: false
        }
    ));
    let operator_ata = fixture.create_ata(fixture.operator.pubkey(), token.mint.pubkey());
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.withdraw_fees(&token, &operator, operator_ata));
    assert_eq!(fixture.token_balance(operator_ata), fee);
}

#[test]
fn withdrawal_enforces_operator_and_destination_constraints() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let operator_ata = fixture.create_ata(fixture.operator.pubkey(), token.mint.pubkey());
    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    let outsider_ata = fixture.create_ata(outsider.pubkey(), token.mint.pubkey());
    assert!(!fixture.withdraw_fees(&token, &outsider, outsider_ata));
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.withdraw_fees(&token, &operator, outsider_ata));
    let wrong_vault = common::TokenFixture {
        mint: token.mint.insecure_clone(),
        game_token: token.game_token,
        game_vault: anchor_lang::prelude::Pubkey::new_unique(),
        vault_ata: token.vault_ata,
    };
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.withdraw_fees(&wrong_vault, &operator, operator_ata));
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.withdraw_fees(&token, &operator, operator_ata));
}
use timba_test_harness as timba;
