use anchor_lang::prelude::*;

pub fn handler(ctx: Context<super::InitializeTelegramUser>, telegram_id: String) -> Result<()> {
    let telegram_user = &mut ctx.accounts.telegram_user;
    telegram_user.telegram_id = telegram_id;
    telegram_user.bot_auth = true;
    Ok(())
}
