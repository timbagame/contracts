mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::AccountDeserialize;
use solana_signer::Signer;
use timba::{
    state::{Game, GameType},
    GameConfig,
};

#[test]
fn creates_games_with_a_precreated_mint_derived_vault() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    assert!(fixture.svm.get_account(&token.vault_ata).is_some());
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

#[test]
fn rejects_a_missing_or_noncanonical_mint_vault() {
    let mut fixture = common::TimbaFixture::new();
    let mint = fixture.create_mint();
    let game_vault =
        Pubkey::find_program_address(&[b"game_vault", mint.pubkey().as_ref()], &timba::id()).0;
    let missing_vault = common::TokenFixture {
        vault_ata: fixture.associated_token_address(game_vault, mint.pubkey()),
        mint,
        game_vault,
    };
    let (creator, creator_ata) = fixture.funded_player(missing_vault.mint.pubkey(), 10_000);
    let (game, instruction) = fixture.initialize_game_instruction(
        &missing_vault,
        creator.pubkey(),
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 4,
            is_private: false,
        },
        [8; 32],
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &creator]));
    assert!(fixture.svm.get_account(&game).is_none());

    let token = fixture.token_fixture();
    let (player, player_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.initialize_game(
        &token,
        &player,
        player_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 4,
            is_private: false,
        },
        [9; 32],
    );
    let mut wrong_vault = fixture.join_instruction(&token, game, player.pubkey(), player_ata);
    let outsider = Pubkey::new_unique();
    fixture.svm.airdrop(&outsider, 1_000_000_000).unwrap();
    wrong_vault
        .accounts
        .iter_mut()
        .find(|meta| meta.pubkey == token.game_vault)
        .expect("join must include the canonical game vault")
        .pubkey = outsider;
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[wrong_vault], &[&operator, &player]));
}
use timba_test_harness as timba;
