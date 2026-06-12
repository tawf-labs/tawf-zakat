use {
    crate::{
        errors::ZktError,
        events::DeadlineExtended,
        state::{Config, Pool, PoolInner, CAMPAIGN_ZAKAT, EXTENSION, GRACE_PERIOD, STATUS_ACTIVE},
    },
    quasar_lang::{
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
};

#[derive(Accounts)]
pub struct ExtendDeadline {
    pub authority: Signer,
    #[account(has_one(authority), address = Config::seeds())]
    pub config: Account<Config>,
    #[account(mut)]
    pub pool: Account<Pool>,
}

impl ExtendDeadline {
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        require_eq!(
            self.pool.campaign_type,
            CAMPAIGN_ZAKAT,
            ZktError::NotZakatPool
        );
        require_eq!(self.pool.status, STATUS_ACTIVE, ZktError::PoolNotActive);
        require!(!bool::from(self.pool.extended), ZktError::AlreadyExtended);

        let now = Clock::get()?.unix_timestamp.get();
        let deadline = i64::from(self.pool.deadline);
        let grace_end = deadline
            .checked_add(GRACE_PERIOD)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        require!(now <= grace_end, ZktError::ExtensionWindowClosed);

        let new_deadline = deadline
            .checked_add(EXTENSION)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        let inner = PoolInner {
            organizer: self.pool.organizer,
            mint: self.pool.mint,
            vault: self.pool.vault,
            index: u64::from(self.pool.index),
            campaign_type: self.pool.campaign_type,
            status: self.pool.status,
            cap: u64::from(self.pool.cap),
            total_donated: u64::from(self.pool.total_donated),
            created_at: i64::from(self.pool.created_at),
            deadline: new_deadline,
            extended: true,
            donation_count: u64::from(self.pool.donation_count),
            disbursement_count: u64::from(self.pool.disbursement_count),
            bump: self.pool.bump,
        };
        self.pool.set_inner(inner);

        emit!(DeadlineExtended {
            pool: *self.pool.address(),
            new_deadline,
        });
        Ok(())
    }
}
