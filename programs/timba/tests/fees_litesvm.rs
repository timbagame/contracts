mod common;

use {
    anchor_lang::AccountDeserialize,
    solana_keypair::Keypair,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{
        state::{Game, GameType},
        GameConfig, OracleConfig,
    },
};

fn winner(
    fixture: &common::TimbaFixture,
    game: anchor_lang::prelude::Pubkey,
    secret: [u8; 32],
    players: &[(anchor_lang::prelude::Pubkey, anchor_lang::prelude::Pubkey)],
) -> (
    u32,
    anchor_lang::prelude::Pubkey,
    anchor_lang::prelude::Pubkey,
) {
    let account = fixture.svm.get_account(&game).unwrap();
    let state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    let index = state.calculate_winner_index(secret).unwrap();
    let (player, ata) = players[index as usize];
    (index, player, ata)
}
use timba_test_harness as timba;

#[test]
fn completion_transfers_the_exact_fee_directly() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let recipient_ata =
        fixture.associated_token_address(fixture.operator.pubkey(), token.mint.pubkey());
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
    let (winner_index, winner, winner_ata) = winner(
        &fixture,
        game,
        secret,
        &[
            (creator.pubkey(), creator_ata),
            (second.pubkey(), second_ata),
        ],
    );
    let winner_before = fixture.token_balance(winner_ata);
    let recipient_before = fixture.token_balance(recipient_ata);
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
    assert_eq!(fixture.token_balance(winner_ata) - winner_before, 1_900);
    assert_eq!(fixture.token_balance(recipient_ata) - recipient_before, 100);
    assert_eq!(fixture.token_balance(token.vault_ata), 0);
}

#[test]
fn completion_rejects_an_unconfigured_fee_recipient() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [38; 32];
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
    let (winner_index, winner, winner_ata) = winner(
        &fixture,
        game,
        secret,
        &[
            (creator.pubkey(), creator_ata),
            (second.pubkey(), second_ata),
        ],
    );
    let mut instruction = fixture.complete_instruction(
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
    let configured_recipient = fixture.operator.pubkey();
    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    instruction
        .accounts
        .iter_mut()
        .find(|meta| meta.pubkey == configured_recipient && !meta.is_signer)
        .expect("completion must include the configured fee recipient")
        .pubkey = outsider.pubkey();

    let operator = fixture.operator.insecure_clone();
    let result = fixture.send_result(&[instruction], &[&operator]);
    assert_eq!(
        common::custom_error_code(result),
        common::anchor_error(timba::error::ErrorCode::InvalidFeeRecipient)
    );
    assert!(fixture.svm.get_account(&game).is_some());
}

#[test]
fn near_u64_max_fee_is_transferred_exactly() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let recipient_ata =
        fixture.associated_token_address(fixture.operator.pubkey(), token.mint.pubkey());
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_oracle(
        &operator,
        OracleConfig {
            fee_percentage: 10,
            fee_recipient: operator.pubkey(),
            oracle_buffer_time: 5,
            max_tickets: 2_048,
            max_timeout: 86_400,
            min_timeout: 1,
        },
    ));
    let prize = 18_446_744_073_709_500_000_u64;
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), prize);
    let participant = Keypair::new();
    fixture
        .svm
        .airdrop(&participant.pubkey(), 1_000_000_000)
        .unwrap();
    let participant_ata = fixture.create_ata(participant.pubkey(), token.mint.pubkey());
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
    assert_eq!(fixture.token_balance(recipient_ata), fee);
}

#[test]
fn oracle_fee_updates_do_not_change_existing_game_economics() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let recipient_ata =
        fixture.associated_token_address(fixture.operator.pubkey(), token.mint.pubkey());
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [37; 32];
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
    let game_account = fixture.svm.get_account(&game).unwrap();
    let game_state = Game::try_deserialize(&mut game_account.data.as_slice()).unwrap();
    assert_eq!(game_state.fee_percentage, 5);

    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_oracle(
        &operator,
        OracleConfig {
            fee_percentage: 10,
            fee_recipient: operator.pubkey(),
            oracle_buffer_time: 5,
            max_tickets: 2_048,
            max_timeout: 86_400,
            min_timeout: 1,
        },
    ));
    assert!(fixture.join_game(&token, game, &creator, creator_ata));
    assert!(fixture.join_game(&token, game, &second, second_ata));
    let (winner_index, winner, winner_ata) = winner(
        &fixture,
        game,
        secret,
        &[
            (creator.pubkey(), creator_ata),
            (second.pubkey(), second_ata),
        ],
    );
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
    assert_eq!(fixture.token_balance(recipient_ata), 100);
}
