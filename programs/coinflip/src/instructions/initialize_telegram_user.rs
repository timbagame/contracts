use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeTelegramUser>, telegram_id: String) -> Result<()> {
    let clock = Clock::get()?;
    let telegram_user = &mut ctx.accounts.telegram_user;
    telegram_user.telegram_id = telegram_id;
    telegram_user.created_at = clock.unix_timestamp;
    telegram_user.bot_auth = true;
    Ok(())
}
