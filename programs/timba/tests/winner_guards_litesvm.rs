mod common;

use {
    anchor_lang::AccountDeserialize,
    solana_keypair::Keypair,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{
        state::{Game, GameType},
        GameConfig,
    },
};

struct ReadyGame {
    fixture: common::TimbaFixture,
    token: common::TokenFixture,
    creator: Keypair,
    creator_ata: anchor_lang::prelude::Pubkey,
    second: Keypair,
    second_ata: anchor_lang::prelude::Pubkey,
    game: anchor_lang::prelude::Pubkey,
    secret: [u8; 32],
    random_hash: [u8; 32],
    winner_index: u32,
}

fn ready_game(seed: u8) -> ReadyGame {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [seed; 32];
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
    let state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    let winner_index = state.calculate_winner_index(secret).unwrap();
    ReadyGame {
        fixture,
        token,
        creator,
        creator_ata,
        second,
        second_ata,
        game,
        secret,
        random_hash,
        winner_index,
    }
}

#[test]
fn rejects_wrong_and_out_of_bounds_winner_indexes() {
    let mut setup = ready_game(43);
    let wrong = 1 - setup.winner_index;
    let (winner, ata) = if setup.winner_index == 0 {
        (setup.creator.pubkey(), setup.creator_ata)
    } else {
        (setup.second.pubkey(), setup.second_ata)
    };
    assert!(!setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        wrong,
        winner,
        ata,
        setup.creator.pubkey(),
    ));
    assert!(!setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        2,
        winner,
        ata,
        setup.creator.pubkey(),
    ));
}

#[test]
fn rejects_nonparticipant_winner_and_mismatched_winner_ata() {
    let mut setup = ready_game(44);
    let (outsider, outsider_ata) = setup.fixture.empty_player(setup.token.mint.pubkey());
    assert!(!setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        setup.winner_index,
        outsider.pubkey(),
        outsider_ata,
        setup.creator.pubkey(),
    ));
    let winner = if setup.winner_index == 0 {
        setup.creator.pubkey()
    } else {
        setup.second.pubkey()
    };
    assert!(!setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        setup.winner_index,
        winner,
        outsider_ata,
        setup.creator.pubkey(),
    ));
}

#[test]
fn rejects_invalid_secret_creator_and_oracle_operator() {
    let mut setup = ready_game(45);
    let (winner, ata) = if setup.winner_index == 0 {
        (setup.creator.pubkey(), setup.creator_ata)
    } else {
        (setup.second.pubkey(), setup.second_ata)
    };
    assert!(!setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        [99; 32],
        setup.winner_index,
        winner,
        ata,
        setup.creator.pubkey(),
    ));
    assert!(!setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        setup.winner_index,
        winner,
        ata,
        setup.second.pubkey(),
    ));
    let outsider = Keypair::new();
    setup
        .fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    let instruction = setup.fixture.complete_instruction(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        setup.winner_index,
        winner,
        ata,
        setup.creator.pubkey(),
        outsider.pubkey(),
    );
    let payer = setup.fixture.operator.insecure_clone();
    assert!(!setup.fixture.send(&[instruction], &[&payer, &outsider]));
}

#[test]
fn valid_completion_closes_game_and_cannot_settle_twice() {
    let mut setup = ready_game(46);
    let (winner, ata) = if setup.winner_index == 0 {
        (setup.creator.pubkey(), setup.creator_ata)
    } else {
        (setup.second.pubkey(), setup.second_ata)
    };
    assert!(setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        setup.winner_index,
        winner,
        ata,
        setup.creator.pubkey(),
    ));
    assert!(setup.fixture.svm.get_account(&setup.game).is_none());
    assert!(!setup.fixture.complete_game(
        &setup.token,
        setup.game,
        setup.random_hash,
        setup.secret,
        setup.winner_index,
        winner,
        ata,
        setup.creator.pubkey(),
    ));
}
use timba_test_harness as timba;
