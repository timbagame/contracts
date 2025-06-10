use crate::state::PlayerBalance;
use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Transfer};

// Helper function to calculate and update player balance, returning the amount needed from tokens
pub fn calculate_player_contribution(
    player_balance: &mut PlayerBalance,
    required_amount: u64,
) -> u64 {
    if player_balance.amount >= required_amount {
        player_balance.amount -= required_amount;
        0 // No tokens needed from wallet
    } else {
        let tokens_needed = required_amount - player_balance.amount;
        player_balance.amount = 0;
        tokens_needed
    }
}

// Helper function for player token transfers (INTERACTIONS only)
pub fn handle_player_token_transfer<'info>(
    player_balance: &mut PlayerBalance,
    game_amount: u64,
    player_token_account: AccountInfo<'info>,
    game_token_account: AccountInfo<'info>,
    player: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
) -> Result<()> {
    // Calculate how much we need from tokens (this updates balance as side effect)
    let needed_amount = calculate_player_contribution(player_balance, game_amount);

    // Only transfer if additional tokens are needed
    if needed_amount > 0 {
        transfer(
            CpiContext::new(
                token_program,
                Transfer {
                    from: player_token_account,
                    to: game_token_account,
                    authority: player,
                },
            ),
            needed_amount,
        )?;
    }

    Ok(())
}

// Helper function for PDA-signed token transfers (INTERACTIONS only)
pub fn handle_pda_token_transfer<'info>(
    from_account: AccountInfo<'info>,
    to_account: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    token_mint: Pubkey,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    let signer_seeds = &[b"game_vault", token_mint.as_ref(), &[vault_bump]];

    transfer(
        CpiContext::new_with_signer(
            token_program,
            Transfer {
                from: from_account,
                to: to_account,
                authority,
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    Ok(())
}
