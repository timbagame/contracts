use crate::events::PlayerBalanceInitialized;
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializePlayerBalance>) -> Result<()> {
    let player_balance = &mut ctx.accounts.player_balance;
    let player_key = ctx.accounts.player.key();
    let token_mint_key = ctx.accounts.token_mint.key();

    // ===============================
    // STATE INITIALIZATION
    // ===============================

    // Initialize dual filter system (filter_a is active by default)
    player_balance.active_filter_index = 0;
    
    // Initialize filter_a
    player_balance.filter_a = crate::state::BloomFilters::default();
    player_balance.filter_a_last_updated = 0;
    player_balance.filter_a_longest_expiry = 0;
    
    // Initialize filter_b
    player_balance.filter_b = crate::state::BloomFilters::default();
    player_balance.filter_b_last_updated = 0;
    player_balance.filter_b_longest_expiry = 0;

    // ===============================
    // EVENT EMISSION
    // ===============================

    emit!(PlayerBalanceInitialized {
        player: player_key,
        token_mint: token_mint_key,
    });

    Ok(())
}
