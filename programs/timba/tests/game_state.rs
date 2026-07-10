use anchor_lang::prelude::Pubkey;
use timba::{
    state::{Game, GameToken, GameType, Oracle},
    utils::{is_supported_token_program, participant_hash},
    GameConfig,
};

#[test]
fn buffer_expiry_boundary_is_inclusive() {
    let game = Game {
        created_at: 100,
        timeout: 4,
        min_tickets: 2,
        max_tickets: 2,
        tickets_count: 2,
        total_amount: 1,
        ..Game::default()
    };
    assert!(!game.is_buffer_expired(2, 105));
    assert!(!game.can_unjoin(2, 105));
    assert!(game.is_buffer_expired(2, 106));
    assert!(game.can_unjoin(2, 106));
}

#[test]
fn oracle_configuration_validation_covers_boundaries() {
    assert!(Oracle::is_valid_fee_percentage(0));
    assert!(Oracle::is_valid_fee_percentage(100));
    assert!(!Oracle::is_valid_fee_percentage(101));
    assert!(!Oracle::is_valid_buffer_time(0));
    assert!(Oracle::is_valid_buffer_time(1));
    assert!(Oracle::is_valid_timeout(10, 10));
    assert!(!Oracle::is_valid_timeout(9, 10));
    assert!(!Oracle::is_valid_tickets_count(0));
    let oracle = Oracle {
        min_timeout: 5,
        max_timeout: 10,
        ..Oracle::default()
    };
    assert!(!oracle.is_valid_timeout_range(4));
    assert!(oracle.is_valid_timeout_range(5));
    assert!(oracle.is_valid_timeout_range(10));
    assert!(!oracle.is_valid_timeout_range(11));
}

#[test]
fn game_ticket_rules_cover_coinflips_and_giveaways() {
    assert!(!Game::is_valid_game_type_tickets(GameType::Coinflip, 1, 1));
    assert!(Game::is_valid_game_type_tickets(GameType::Coinflip, 2, 2));
    assert!(!Game::is_valid_game_type_tickets(GameType::Giveaway, 1, 0));
    assert!(Game::is_valid_game_type_tickets(GameType::Giveaway, 1, 1));
    assert!(Game::is_valid_tickets_count(3, 2, 3));
    assert!(!Game::is_valid_tickets_count(3, 4, 10));
    assert!(!Game::is_valid_tickets_count(11, 2, 10));
}

#[test]
fn game_initialization_sets_type_specific_amounts() {
    let creator = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let config = |game_type, amount| GameConfig {
        game_type,
        amount,
        max_tickets: 4,
        min_tickets: 2,
        timeout: 30,
        is_private: true,
    };
    let mut coinflip = Game::default();
    coinflip.initialize(creator, mint, &config(GameType::Coinflip, 500), 100, 7);
    assert_eq!(coinflip.ticket_amount, 500);
    assert_eq!(coinflip.total_amount, 0);
    let mut giveaway = Game::default();
    giveaway.initialize(creator, mint, &config(GameType::Giveaway, 900), 100, 7);
    assert_eq!(giveaway.ticket_amount, 0);
    assert_eq!(giveaway.total_amount, 900);
}

#[test]
fn completion_and_unjoin_windows_cover_all_states() {
    let mut game = Game {
        created_at: 100,
        timeout: 10,
        min_tickets: 2,
        max_tickets: 3,
        tickets_count: 2,
        total_amount: 20,
        ..Game::default()
    };
    assert!(!game.is_ready_for_completion(109));
    assert!(game.is_ready_for_completion(110));
    assert!(game.waiting_for_oracle(5, 110));
    assert!(!game.can_unjoin(5, 110));
    assert!(game.is_buffer_expired(5, 115));
    assert!(!game.waiting_for_oracle(5, 115));
    assert!(game.can_unjoin(5, 115));
    game.tickets_count = 3;
    assert!(game.is_ready_for_completion(100));
    game.complete();
    assert!(!game.waiting_for_oracle(5, 100));
}

#[test]
fn winner_index_is_bounded_deterministic_and_reaches_every_slot() {
    for tickets in 1..=64 {
        for sample in 0_u64..200 {
            let mut secret = [0_u8; 32];
            secret[..8].copy_from_slice(&sample.to_le_bytes());
            let game = Game {
                tickets_count: tickets,
                last_slot: sample * 17,
                ..Game::default()
            };
            let first = game.calculate_winner_index(secret).unwrap();
            assert!(first < tickets);
            assert_eq!(first, game.calculate_winner_index(secret).unwrap());
        }
    }
    let game = Game {
        tickets_count: 8,
        last_slot: 42,
        ..Game::default()
    };
    let mut seen = [false; 8];
    for sample in 0_u64..2_048 {
        let mut secret = [0_u8; 32];
        secret[..8].copy_from_slice(&sample.to_le_bytes());
        seen[game.calculate_winner_index(secret).unwrap() as usize] = true;
    }
    assert!(seen.into_iter().all(|value| value));
}

#[test]
fn fee_math_and_accumulation_are_exact_near_u64_max() {
    let game = Game {
        total_amount: 18_446_744_073_709_500_000,
        ..Game::default()
    };
    assert_eq!(game.calculate_amounts(100), (0, game.total_amount));
    let (winner, fee) = game.calculate_amounts(7);
    assert_eq!(winner.checked_add(fee), Some(game.total_amount));
    let mut token = GameToken {
        fee_amount: u64::MAX - 1,
        ..GameToken::default()
    };
    token.accrue_fee(1).unwrap();
    assert_eq!(token.fee_amount, u64::MAX);
    assert!(token.accrue_fee(1).is_err());
    assert_eq!(token.drain_fees(), u64::MAX);
}

#[test]
fn participant_accounting_guards_overflow_and_capacity() {
    let mut game = Game {
        ticket_amount: u64::MAX / 3,
        max_tickets: 4,
        ..Game::default()
    };
    for hash in 1..=3 {
        game.add_player_to_game(hash).unwrap();
    }
    assert!(game.add_player_to_game(4).is_err());
    assert_eq!(game.remove_participant(2).unwrap(), 1);
    assert!(!game.contains_participant(2));

    let mut capacity = Game {
        ticket_amount: 750_000,
        max_tickets: 1_024,
        ..Game::default()
    };
    for hash in 1..=1_024 {
        capacity.add_player_to_game(hash).unwrap();
    }
    assert_eq!(capacity.total_amount, 768_000_000);
    assert!(capacity.add_player_to_game(1_025).is_err());
}

#[test]
fn participant_hash_and_token_program_helpers_are_stable() {
    let game = Pubkey::new_unique();
    let player = Pubkey::new_unique();
    let hash = participant_hash(&game, &player);
    assert_eq!(hash, participant_hash(&game, &player));
    assert_ne!(hash, participant_hash(&game, &Pubkey::new_unique()));
    assert!(is_supported_token_program(&anchor_spl::token::ID));
    assert!(is_supported_token_program(&anchor_spl::token_2022::ID));
    assert!(!is_supported_token_program(&Pubkey::new_unique()));
}

#[test]
fn single_ticket_always_selects_first_participant() {
    let game = Game {
        tickets_count: 1,
        ..Game::default()
    };
    assert_eq!(game.calculate_winner_index([1; 32]), Some(0));
}
