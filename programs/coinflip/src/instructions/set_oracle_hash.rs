use crate::events::OracleHashSet;
use crate::state::GameStatus;
use crate::state::GameType;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::sysvar::slot_hashes;
use anchor_spl::token;

pub fn handler(ctx: Context<super::SetOracleHash>, hash_value: [u8; 32]) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Calculate winner amount and fee amount checking game type
    if game.game_type == GameType::Coinflip {
        let total_amount = game.amount * game.players.len() as u64;
        game.fee_amount = total_amount * (ctx.accounts.oracle.fee_percentage as u64) / 100;
        game.winner_amount = total_amount - game.fee_amount;
    } else {
        let total_amount = game.amount;
        game.fee_amount = total_amount * (ctx.accounts.oracle.fee_percentage as u64) / 100;
        game.winner_amount = total_amount - game.fee_amount;
    }

    // Get slot hash for on-chain randomness
    let slot_hash = slot_hashes::id().to_bytes();

    // Combine oracle hash with slot hash
    let mut combined = Vec::with_capacity(64); // 32 + 32
    combined.extend_from_slice(&hash_value);
    combined.extend_from_slice(&slot_hash);
    let final_hash = hash(&combined).to_bytes();
    let random_number = usize::from_le_bytes(final_hash[0..8].try_into().unwrap());
    let random_index = random_number % game.players.len();
    game.winner = game.players[random_index];
    game.status = GameStatus::ReadyForClaim;

    // Transfer fees to oracle
    if game.fee_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.game_token_account.to_account_info(),
                    to: ctx.accounts.oracle_token_account.to_account_info(),
                    authority: ctx.accounts.game_vault.to_account_info(),
                },
                &[&[
                    b"game_vault",
                    game.token_mint.as_ref(),
                    &[ctx.bumps.game_vault],
                ]],
            ),
            game.fee_amount,
        )?;
    }

    emit!(OracleHashSet {
        game_id: game.id,
        winner: game.winner,
        winner_amount: game.winner_amount,
        fee_amount: game.fee_amount,
        total_players: game.players.len() as u16,
    });

    Ok(())
}
