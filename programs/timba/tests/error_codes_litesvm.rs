mod common;

use {
    solana_keypair::Keypair,
    solana_signer::Signer,
    timba::{error::ErrorCode, state::GameType, GameConfig, TokenConfig},
};

#[test]
fn error_codes_are_sequential_within_each_category() {
    let categories = [
        vec![
            ErrorCode::UnauthorizedOperator as u32,
            ErrorCode::UnauthorizedPlayer as u32,
            ErrorCode::InvalidCreator as u32,
        ],
        vec![
            ErrorCode::GameFull as u32,
            ErrorCode::GameWaitingForOracle as u32,
            ErrorCode::GameNotReadyForOracle as u32,
            ErrorCode::GameHasActivePlayers as u32,
            ErrorCode::GameExpired as u32,
            ErrorCode::GameAlreadyCompleted as u32,
            ErrorCode::OracleBufferNotExpired as u32,
            ErrorCode::ParticipantStorageExceeded as u32,
        ],
        vec![
            ErrorCode::AlreadyJoined as u32,
            ErrorCode::InsufficientBalance as u32,
            ErrorCode::WinnerIndexMismatch as u32,
            ErrorCode::WinnerIndexOutOfRange as u32,
            ErrorCode::WinnerPubkeyMismatch as u32,
            ErrorCode::PrivateGameAccessDenied as u32,
            ErrorCode::RandomnessGenerationFailed as u32,
            ErrorCode::ParticipantNotFound as u32,
            ErrorCode::ParticipantIndexOutOfRange as u32,
            ErrorCode::ArithmeticOverflow as u32,
        ],
        vec![
            ErrorCode::InvalidTicketsCount as u32,
            ErrorCode::InvalidTimeout as u32,
            ErrorCode::InvalidAmount as u32,
            ErrorCode::InvalidSecretKey as u32,
            ErrorCode::InvalidOracleBufferTime as u32,
        ],
    ];

    for codes in categories {
        assert!(codes.windows(2).all(|pair| pair[1] == pair[0] + 1));
    }

    assert_eq!(ErrorCode::TokenNotEnabled as u32, 1400);
    assert_eq!(ErrorCode::InvalidTokenMint as u32, 1401);
    assert_eq!(ErrorCode::TokenVaultNotEmpty as u32, 1403);
    assert_eq!(ErrorCode::TokenFeesOutstanding as u32, 1404);
}

#[test]
fn preserves_named_configuration_token_and_authorization_errors() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (_game, invalid_config) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 1,
            min_tickets: 1,
            timeout: 30,
            is_private: false,
        },
        [54; 32],
    );
    let payer = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[invalid_config], &[&payer, &creator])),
        common::anchor_error(ErrorCode::InvalidTicketsCount)
    );

    let operator = fixture.operator.insecure_clone();
    assert!(fixture.update_token(
        &token,
        &operator,
        TokenConfig {
            min_amount: 1_000,
            enabled: false
        },
    ));
    let (_game, disabled) = fixture.initialize_game_instruction(
        &token,
        creator.pubkey(),
        creator_ata,
        GameConfig {
            game_type: GameType::Coinflip,
            amount: 1_000,
            max_tickets: 2,
            min_tickets: 2,
            timeout: 30,
            is_private: false,
        },
        [55; 32],
    );
    let payer = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[disabled], &[&payer, &creator])),
        common::anchor_error(ErrorCode::TokenNotEnabled)
    );

    let outsider = Keypair::new();
    fixture
        .svm
        .airdrop(&outsider.pubkey(), 1_000_000_000)
        .unwrap();
    let outsider_ata = fixture.create_ata(outsider.pubkey(), token.mint.pubkey());
    let withdraw = fixture.withdraw_fees_instruction(&token, outsider.pubkey(), outsider_ata);
    let payer = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[withdraw], &[&payer, &outsider])),
        common::anchor_error(ErrorCode::UnauthorizedOperator)
    );
}

#[test]
fn preserves_join_and_buffer_error_codes() {
    let mut fixture = common::TimbaFixture::new();
    let token = fixture.token_fixture();
    let (creator, creator_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (second, second_ata) = fixture.funded_player(token.mint.pubkey(), 10_000);
    let (poor, poor_ata) = fixture.empty_player(token.mint.pubkey());
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
        [56; 32],
    );
    let poor_join = fixture.join_instruction(&token, game, poor.pubkey(), poor_ata);
    let payer = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[poor_join], &[&payer, &poor])),
        common::anchor_error(ErrorCode::InsufficientBalance)
    );
    assert!(fixture.join_game(&token, game, &creator, creator_ata));
    let duplicate = fixture.join_instruction(&token, game, creator.pubkey(), creator_ata);
    let payer = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[duplicate], &[&payer, &creator])),
        common::anchor_error(ErrorCode::AlreadyJoined)
    );
    assert!(fixture.join_game(&token, game, &second, second_ata));
    let early_unjoin = fixture.unjoin_instruction(
        &token,
        game,
        creator.pubkey(),
        creator.pubkey(),
        creator_ata,
    );
    let payer = fixture.operator.insecure_clone();
    assert_eq!(
        common::custom_error_code(fixture.send_result(&[early_unjoin], &[&payer, &creator])),
        common::anchor_error(ErrorCode::OracleBufferNotExpired)
    );
}
