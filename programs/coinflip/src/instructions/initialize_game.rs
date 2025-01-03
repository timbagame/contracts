use anchor_lang::prelude::*;
use anchor_spl::token;

use crate::events::GameInitialized;
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
    game.token_mint = ctx.accounts.token_mint.key();
    game.created_at = Clock::get()?.unix_timestamp;
    game.timeout = timeout;
    game.is_private = is_private;

    if game.game_type == GameType::Coinflip {
        game.players.push(ctx.accounts.player.key());
    }

    // Increment game counter
    let oracle = &mut ctx.accounts.oracle;
    oracle.games_counter += 1;

    // Transfer tokens from creator to game account
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.game_token_account.to_account_info(),
                authority: ctx.accounts.player_vault.to_account_info(),
            },
            &[&[
                b"player_vault",
                ctx.accounts.player.key().as_ref(),
                &[ctx.bumps.player_vault],
            ]],
        ),
        game.amount,
    )?;

    emit!(GameInitialized {
        game_id: game.id,
        creator: ctx.accounts.player.key(),
        game_type: game.game_type,
        amount: game.amount,
        max_players: game.max_players,
        min_players: game.min_players,
        timeout: game.timeout,
        is_private: game.is_private,
    });

    Ok(())
}
