use {
    crate::{
        events::ConfigInitialized,
        state::{Config, ConfigInner},
    },
    quasar_lang::prelude::*,
};

#[derive(Accounts)]
pub struct InitConfig {
    #[account(mut)]
    pub authority: Signer,
    #[account(init, payer = authority, address = Config::seeds())]
    pub config: Account<Config>,
    pub system_program: Program<SystemProgram>,
}

impl InitConfig {
    #[inline(always)]
    pub fn handler(
        &mut self,
        fallback_authority: Address,
        max_pool_cap: u64,
        bumps: &InitConfigBumps,
    ) -> Result<(), ProgramError> {
        let authority = *self.authority.address();
        self.config.set_inner(ConfigInner {
            authority,
            pending_authority: Address::default(),
            fallback_authority,
            max_pool_cap,
            paused: false,
            bump: bumps.config,
        });

        emit!(ConfigInitialized {
            authority,
            fallback_authority,
            max_pool_cap,
        });
        Ok(())
    }
}
