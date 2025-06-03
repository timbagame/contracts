use crate::state::PlayerBalance;
use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Transfer};

// Helper function for player token transfers
pub fn handle_player_token_transfer<'info>(
    player_balance: &mut PlayerBalance,
    game_amount: u64,
    player_token_account: AccountInfo<'info>,
    game_token_account: AccountInfo<'info>,
    player: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
) -> Result<()> {
    let needed_amount = if player_balance.amount >= game_amount {
        player_balance.amount -= game_amount;
        0
    } else {
        let needed = game_amount - player_balance.amount;
        player_balance.amount = 0;
        needed
    };

    // Only transfer if additional tokens are needed
    if needed_amount > 0 {
        transfer(
            CpiContext::new(
                token_program.clone(),
                Transfer {
                    from: player_token_account.clone(),
                    to: game_token_account.clone(),
                    authority: player.clone(),
                },
            ),
            needed_amount,
        )?;
    }

    Ok(())
}

// Helper function for PDA-signed token transfers
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
            token_program.clone(),
            Transfer {
                from: from_account.clone(),
                to: to_account.clone(),
                authority: authority.clone(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    Ok(())
}
