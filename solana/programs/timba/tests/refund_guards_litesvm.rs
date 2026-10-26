mod common;

use {
    anchor_lang::prelude::Clock,
    solana_signer::Signer,
    timba::{error::ErrorCode, state::GameType, GameConfig},
};

#[test]
fn rejects_nonparticipant_and_empty_game_refunds() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (outsider, outsider_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let game = fixture.create_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 3,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [15; 32],
    );
    assert!(fixture.join_game(&token, game, &creator, creator_ata));
    // Entries unlock at timeout, so membership is checked only after expiry.
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += 31;
    fixture.svm.set_sysvar(&clock);
    let instruction = fixture.refund_player_instruction(
        &token,
        game,
        outsider.pubkey(),
        outsider.pubkey(),
        outsider_ata,
    );
    let operator = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[instruction], &[&operator, &outsider])),
        common::anchor_error(ErrorCode::ParticipantNotFound)
    );

    let empty_game = fixture.create_game(
        &token,
        &creator,
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 3,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [16; 32],
    );
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += 31;
    fixture.svm.set_sysvar(&clock);
    let instruction = fixture.refund_player_instruction(
        &token,
        empty_game,
        outsider.pubkey(),
        outsider.pubkey(),
        outsider_ata,
    );
    let operator = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[instruction], &[&operator, &outsider])),
        common::anchor_error(ErrorCode::ParticipantNotFound)
    );
}
use timba_test_harness as timba;
