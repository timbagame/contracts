mod common;
use anchor_lang::{prelude::Clock, AccountDeserialize};
use solana_sha256_hasher::hash;
use solana_signer::Signer;
use timba::{
    state::{Game, GameType},
    GameConfig, OracleConfig,
};
use timba_test_harness as timba;

#[test]
fn shared_vectors_execute_on_solana() {
    // Reuse the loaded program and restore isolated account state for each case.
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let players: Vec<_> = (0..4)
        .map(|_| fixture.funded_player(token.mint.pubkey(), 10_000))
        .collect();
    let baseline = fixture.svm.clone();
    for line in include_str!("../../../fixtures/lifecycle.csv")
        .lines()
        .skip(1)
    {
        let v: Vec<u64> = line.split(',').map(|x| x.parse().unwrap()).collect();
        fixture.svm = baseline.clone();
        let mut clock = fixture.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = 1_000;
        fixture.svm.set_sysvar(&clock);
        let operator = fixture.operator.insecure_clone();
        assert!(fixture.update_oracle(
            &operator,
            OracleConfig {
                fee_percentage: u8::try_from(v[8]).unwrap(),
                oracle_buffer_time: 10,
                min_timeout: 1,
                max_timeout: 100,
                max_tickets: 4,
            }
        ));
        let secret = [42; 32];
        let commitment = hash(&secret).to_bytes();
        let game = fixture.initialize_game(
            &token,
            &creator,
            creator_ata,
            GameConfig {
                game_type: if v[0] == 0 {
                    GameType::Coinflip
                } else {
                    GameType::Giveaway
                },
                amount: v[7],
                min_tickets: u32::try_from(v[2]).unwrap(),
                max_tickets: u32::try_from(v[3]).unwrap(),
                timeout: 100,
                is_private: false,
            },
            commitment,
        );
        let count = usize::try_from(v[1]).unwrap();
        for (player, ata) in players.iter().take(count) {
            assert!(fixture.join_game(&token, game, player, *ata));
            assert!(!fixture.join_game(&token, game, player, *ata));
        }
        clock.unix_timestamp = i64::try_from(v[4]).unwrap();
        fixture.svm.set_sysvar(&clock);
        if let Some((player, ata)) = players[..count].first() {
            let ix =
                fixture.unjoin_instruction(&token, game, player.pubkey(), creator.pubkey(), *ata);
            assert_eq!(
                fixture.send(&[ix], &[&operator, &creator]),
                v[6] == 1,
                "{line}"
            );
        }
        let account = fixture.svm.get_account(&game).unwrap();
        let state = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
        let (index, winner, ata) = if state.tickets_count == 0 {
            (0, creator.pubkey(), creator_ata)
        } else {
            let index = state.calculate_winner_index(secret).unwrap();
            let winner = state.participants[index as usize];
            let ata = fixture.associated_token_address(winner, token.mint.pubkey());
            (index, winner, ata)
        };
        let operator_ata = fixture.associated_token_address(operator.pubkey(), token.mint.pubkey());
        let fee_before = fixture.token_balance(operator_ata);
        assert_eq!(
            fixture.complete_game(
                &token,
                game,
                commitment,
                secret,
                index,
                winner,
                ata,
                creator.pubkey()
            ),
            v[5] == 1,
            "{line}"
        );
        if v[5] == 1 {
            assert_eq!(
                fixture.token_balance(operator_ata) - fee_before,
                v[9],
                "{line}"
            );
            assert!(fixture.svm.get_account(&game).is_none());
        }
    }
}
