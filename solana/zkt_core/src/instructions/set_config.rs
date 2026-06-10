use {
    crate::{
        events::ConfigUpdated,
        state::{Config, ConfigInner},
    },
    quasar_lang::prelude::*,
};

#[derive(Accounts)]
pub struct SetConfig {
    pub authority: Signer,
    #[account(mut, has_one(authority), address = Config::seeds())]
    pub config: Account<Config>,
}

impl SetConfig {
    #[inline(always)]
    pub fn handler(
        &mut self,
        fallback_authority: Address,
        max_pool_cap: u64,
        paused: bool,
    ) -> Result<(), ProgramError> {
        let authority = self.config.authority;
        let pending_authority = self.config.pending_authority;
        let bump = self.config.bump;

        self.config.set_inner(ConfigInner {
            authority,
            pending_authority,
            fallback_authority,
            max_pool_cap,
            paused,
            bump,
        });

        emit!(ConfigUpdated {
            fallback_authority,
            max_pool_cap,
            paused: paused as u64,
        });
        Ok(())
    }
}
