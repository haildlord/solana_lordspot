use anchor_lang::prelude::*;

declare_id!("5VzRfyAp1CsAVfaoySZqWkJpojVUfWmgx9kLq6Rv99oU");

#[program]
pub mod solana_smart_contracts {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
