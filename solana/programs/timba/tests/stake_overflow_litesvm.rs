mod common;
use timba_test_harness as timba;

use solana_signer::Signer;
use timba::{state::GameType, GameConfig};

#[test]
fn rejects_unfillable_pot_before_any_deposit() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, ata) = fixture.empty_player(token.mint.pubkey());
    let (game, instruction) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: u64::MAX / 3,
            max_tickets: 4,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [48; 32],
    );
    let operator = fixture.operator.insecure_clone();
    assert!(!fixture.send(&[instruction], &[&operator, &creator]));
    assert!(fixture.svm.get_account(&game).is_none());
}
