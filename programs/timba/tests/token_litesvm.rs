mod common;

use anchor_lang::AccountDeserialize;
use solana_signer::Signer;
use timba::{
    state::{Game, GameToken, GameType},
    GameConfig,
};

#[test]
fn initializes_legacy_token_configuration_and_vault() {
    let mut fixture = common::TimbaFixture::new();
    let mint = fixture.create_mint();
    let (game_token, _vault, vault_ata) = fixture.initialize_token(mint.pubkey());

    let account = fixture.svm.get_account(&game_token).unwrap();
    let state = GameToken::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(state.token_mint, mint.pubkey());
    assert_eq!(state.min_amount, 1_000);
    assert!(state.enabled);
    assert_eq!(state.fee_amount, 0);
    assert!(fixture.svm.get_account(&vault_ata).is_some());
}

#[test]
fn initializes_coinflip_game_with_real_token_accounts() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
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
        [7; 32],
    );
    let account = fixture.svm.get_account(&game).unwrap();
    let state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(state.creator, creator.pubkey());
    assert_eq!(state.ticket_amount, 1_000);
    assert_eq!(state.tickets_count, 0);
    assert_eq!(state.total_amount, 0);
}
use timba_test_harness as timba;
