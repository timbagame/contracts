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
fn fills_high_capacity_game_with_exact_ordered_participants() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let mut players = Vec::with_capacity(65);
    for _ in 0..65 {
        players.push(fixture.funded_player(token.mint.pubkey(), 750_000));
    }
    let game = fixture.initialize_game(
        &token,
        &players[0].0,
        players[0].1,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 750_000,
            max_tickets: 65,
            min_tickets: 2,
            timeout: 180,
            is_private: false,
        },
        [28; 32],
    );
    for (player, ata) in &players {
        assert!(fixture.join_game(&token, game, player, *ata));
    }
    let account = fixture.svm.get_account(&game).unwrap();
    let state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(state.tickets_count, 65);
    assert_eq!(state.participants.len(), 65);
    assert_eq!(state.total_amount, 48_750_000);
    for (index, (player, _)) in players.iter().enumerate() {
        assert_eq!(state.participants[index], player.pubkey());
    }
}
