use {
    crate::{
        errors::ZktError,
        events::{AuthorityTransferStarted, AuthorityTransferred},
        state::{Config, ConfigInner},
    },
    quasar_lang::prelude::*,
};

#[derive(Accounts)]
pub struct TransferAuthority {
    pub authority: Signer,
    #[account(mut, has_one(authority), address = Config::seeds())]
    pub config: Account<Config>,
}

impl TransferAuthority {
    #[inline(always)]
    pub fn handler(&mut self, new_authority: Address) -> Result<(), ProgramError> {
        let current = self.config.authority;
        let fallback_authority = self.config.fallback_authority;
        let max_pool_cap = u64::from(self.config.max_pool_cap);
        let paused = bool::from(self.config.paused);
        let bump = self.config.bump;

        self.config.set_inner(ConfigInner {
            authority: current,
            pending_authority: new_authority,
            fallback_authority,
            max_pool_cap,
            paused,
            bump,
        });

        emit!(AuthorityTransferStarted {
            current,
            pending: new_authority,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct AcceptAuthority {
    pub new_authority: Signer,
    #[account(mut, address = Config::seeds())]
    pub config: Account<Config>,
}

impl AcceptAuthority {
    #[inline(always)]
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        let pending = self.config.pending_authority;
        require!(
            pending != Address::default(),
            ZktError::NoPendingAuthority
        );
        require_keys_eq!(
            pending,
            *self.new_authority.address(),
            ZktError::Unauthorized
        );

        let previous = self.config.authority;
        let fallback_authority = self.config.fallback_authority;
        let max_pool_cap = u64::from(self.config.max_pool_cap);
        let paused = bool::from(self.config.paused);
        let bump = self.config.bump;

        self.config.set_inner(ConfigInner {
            authority: pending,
            pending_authority: Address::default(),
            fallback_authority,
            max_pool_cap,
            paused,
            bump,
        });

        emit!(AuthorityTransferred {
            previous,
            new: pending,
        });
        Ok(())
    }
}
