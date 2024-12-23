use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeTelegramAccount>, telegram_id: String) -> Result<()> {
    let clock = Clock::get()?;

    // Set account data
    let telegram_account = &mut ctx.accounts.telegram_account;
    telegram_account.telegram_id = telegram_id;
    telegram_account.created_at = clock.unix_timestamp;
    telegram_account.bot_auth = true;

    Ok(())
}
