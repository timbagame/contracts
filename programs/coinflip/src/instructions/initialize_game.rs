use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::state::GameType;

pub fn handler(
    ctx: Context<super::InitializeGame>,
    game_type: GameType,
    amount: u64,
    max_players: u16,
    min_players: u16,
    timeout: i64,
    is_private: bool,
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    game.id = ctx.accounts.oracle.games_counter;
    game.creator = ctx.accounts.creator.key();
    game.game_type = game_type;
    game.amount = amount;
    game.max_players = max_players;
    game.min_players = min_players;
    game.players = Vec::with_capacity(max_players as usize);
    game.status = crate::state::GameStatus::Active;
    game.token_mint = ctx.accounts.token_mint.key();
    game.created_at = Clock::get()?.unix_timestamp;
    game.timeout = timeout;
    game.is_private = is_private;

    if game.game_type == GameType::Coinflip {
        game.players.push(ctx.accounts.creator.key());
    }

    // Transfer tokens from creator to game account
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.creator_token_account.to_account_info(),
                to: ctx.accounts.game_token_account.to_account_info(),
                authority: ctx.accounts.creator_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    // Increment game counter
    let oracle = &mut ctx.accounts.oracle;
    oracle.games_counter += 1;

    Ok(())
}
