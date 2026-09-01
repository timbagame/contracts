mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_program, AccountDeserialize},
    solana_keypair::Keypair,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    timba::{
        state::{Game, GameToken, GameType},
        GameConfig,
    },
};

fn state(fixture: &common::TimbaFixture, token: &common::TokenFixture) -> GameToken {
    let account = fixture.svm.get_account(&token.game_token).unwrap();
    GameToken::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn initialize_token_enforces_operator_and_program_accounts() {
    let mut fixture = common::TimbaFixture::new();
    let mint = fixture.create_mint();
    let token = fixture.uninitialized_token_fixture(mint);
    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    let unauthorized = fixture.initialize_token_instruction_with_accounts(
        &token,
        outsider.pubkey(),
        anchor_spl::token::ID,
    );
    let payer = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[unauthorized], &[&payer, &outsider]));
    let unsupported = fixture.initialize_token_instruction_with_accounts(
        &token,
        fixture.operator.pubkey(),
        system_program::ID,
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[unsupported], &[&operator]));
    let invalid = fixture.initialize_token_instruction_with_accounts(
        &token,
        fixture.operator.pubkey(),
        Pubkey::new_unique(),
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[invalid], &[&operator]));
    assert!(fixture.svm.get_account(&token.game_token).is_none());
}

#[test]
fn closes_only_empty_fee_free_token_vault() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let operator = fixture.operator.insecure_clone();
    assert!(fixture.close_token(&token, &operator));
    assert!(fixture.svm.get_account(&token.game_token).is_none());
    assert!(fixture.svm.get_account(&token.vault_ata).is_none());
}

#[test]
fn rejects_close_when_vault_contains_tokens() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (player, player_ata) = fixture.funded_player(token.mint.pubkey(), 1_000);
    fixture.initialize_game(
        &token,
        &player,
        player_ata,
        GameConfig {
            game_type: GameType::Giveaway,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 1,
            timeout: 30,
            is_private: false,
        },
        [30; 32],
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.close_token(&token, &operator));
    assert!(fixture.svm.get_account(&token.game_token).is_some());
}

#[test]
fn rejects_close_when_fees_are_outstanding() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let secret = [52; 32];
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
    assert!(state(&fixture, &token).fee_amount > 0);
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.close_token(&token, &operator));
}
use timba_test_harness as timba;
