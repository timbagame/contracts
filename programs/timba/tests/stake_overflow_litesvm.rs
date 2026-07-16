mod common;

use {
    anchor_lang::AccountDeserialize,
    solana_signer::Signer,
    timba::{
        state::{Game, GameType},
        GameConfig,
    },
};

#[test]
fn fourth_large_stake_cannot_overflow_game_total() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let stake = 6_148_914_691_236_517_205_u64;
    let mut players = Vec::new();
    for _ in 0..4 {
        let (player, ata) = fixture.empty_player(token.mint.pubkey());
        fixture.set_token_balance(ata, stake);
        players.push((player, ata));
    }
    let game = fixture.initialize_game(
        &token,
        &players[0].0,
        players[0].1,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: stake,
            max_tickets: 4,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [48; 32],
    );
    for (player, ata) in players.iter().take(3) {
        assert!(fixture.join_game(&token, game, player, *ata));
    }
    let account = fixture.svm.get_account(&game).unwrap();
    let before = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(before.total_amount, u64::MAX);
    assert!(!fixture.join_game(&token, game, &players[3].0, players[3].1));
    let account = fixture.svm.get_account(&game).unwrap();
    let after = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(after.total_amount, u64::MAX);
    assert_eq!(after.tickets_count, 3);
}
use timba_test_harness as timba;
