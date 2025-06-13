use crate::state::PlayerBalance;
use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Transfer};

// =============================================================================
// PLAYER BALANCE UTILITIES
// =============================================================================

/// Calculates and updates player balance, returning the amount needed from token wallet.
/// 
/// This function first uses the player's existing balance to cover the required amount,
/// then returns how much additional tokens are needed from their wallet.
/// 
/// # Arguments
/// * `player_balance` - Mutable reference to player's balance account
/// * `required_amount` - Total amount required for the operation
/// 
/// # Returns
/// Amount of tokens needed from the player's wallet (0 if balance covers everything)
pub fn calculate_player_contribution(
    player_balance: &mut PlayerBalance,
    required_amount: u64,
) -> u64 {
    if player_balance.amount >= required_amount {
        player_balance.amount -= required_amount;
        0
    } else {
        let tokens_needed = required_amount - player_balance.amount;
        player_balance.amount = 0;
        tokens_needed
    }
}

// =============================================================================
// TOKEN TRANSFER UTILITIES
// =============================================================================

/// Handles player token transfers by combining balance and wallet tokens.
/// 
/// This function calculates the optimal use of player balance and wallet tokens,
/// then performs the necessary token transfer if additional tokens are needed.
/// 
/// # Arguments
/// * `player_balance` - Player's balance account (updated as side effect)
/// * `game_amount` - Total amount required for the game
/// * `player_token_account` - Player's token wallet account
/// * `game_token_account` - Game's token vault account
/// * `player` - Player account (authority for the transfer)
/// * `token_program` - SPL Token program
pub fn handle_player_token_transfer<'info>(
    player_balance: &mut PlayerBalance,
    game_amount: u64,
    player_token_account: AccountInfo<'info>,
    game_token_account: AccountInfo<'info>,
    player: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
) -> Result<()> {
    let needed_amount = calculate_player_contribution(player_balance, game_amount);

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

/// Handles PDA-signed token transfers for withdrawals and fee collection.
/// 
/// This function performs token transfers where the authority is a PDA (Program Derived Address),
/// such as when transferring tokens from the game vault to players or fee collectors.
/// 
/// # Arguments
/// * `from_account` - Source token account
/// * `to_account` - Destination token account  
/// * `authority` - PDA authority account
/// * `token_program` - SPL Token program
/// * `token_mint` - Token mint pubkey (used for PDA seeds)
/// * `vault_bump` - Bump seed for the vault PDA
/// * `amount` - Amount of tokens to transfer
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
