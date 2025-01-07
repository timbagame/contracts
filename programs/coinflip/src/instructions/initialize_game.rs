use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::GameType;

pub fn handler(
    ctx: Context<super::InitializeGame>,
    game_type: GameType,
    amount: u64,
    max_players: u16,
    min_players: u16,
    timeout: u16,
    is_private: bool,
) -> Result<()> {
    // Initialize game
    let game = &mut ctx.accounts.game;
    game.id = ctx.accounts.oracle.games_counter;
    game.creator = ctx.accounts.player.key();
    game.game_type = game_type;
    game.amount = amount;
    game.max_players = max_players;
    game.min_players = min_players;
    game.players = Vec::with_capacity(max_players as usize);
    game.status = crate::state::GameStatus::Active;
    game.token_mint = ctx.accounts.game_token.token_mint;
    game.created_at = Clock::get()?.unix_timestamp as u64;
    game.timeout = timeout;
    game.is_private = is_private;

    if game.game_type == GameType::Coinflip {
        game.players.push(ctx.accounts.player.key());
    }

    // Increment game counter
    let oracle = &mut ctx.accounts.oracle;
    oracle.games_counter += 1;

    // Check player token amount
    let player_token = &mut ctx.accounts.player_token;
    let needed_amount = if player_token.amount >= game.amount {
        player_token.amount -= game.amount;
        0
    } else {
        let needed = game.amount - player_token.amount;
        player_token.amount = 0;
        needed
    };

    // Only transfer if additional tokens are needed
    if needed_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.player_token_account.to_account_info(),
                    to: ctx.accounts.game_token_account.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            needed_amount,
        )?;
    }

    Ok(())
}
