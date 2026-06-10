use {
    crate::{
        errors::ZktError,
        events::Redistributed,
        state::{
            Config, Pool, PoolInner, CAMPAIGN_ZAKAT, GRACE_PERIOD, STATUS_ACTIVE, STATUS_CLOSED,
        },
    },
    quasar_lang::{
        cpi::Seed,
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
    quasar_spl::prelude::*,
};

/// Permissionless: anyone may trigger redistribution once a zakat pool's
/// deadline + grace period has fully lapsed (sharia: zakat must be
/// distributed, not parked). Funds go to a token account owned by the
/// config's fallback authority.
#[derive(Accounts)]
pub struct Redistribute {
    #[account(address = Config::seeds())]
    pub config: Account<Config>,
    #[account(mut, has_one(vault))]
    pub pool: Account<Pool>,
    #[account(mut)]
    pub vault: Account<Token>,
    #[account(mut)]
    pub fallback_ta: Account<Token>,
    pub token_program: Program<TokenProgram>,
}

impl Redistribute {
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        require_eq!(
            self.pool.campaign_type,
            CAMPAIGN_ZAKAT,
            ZktError::NotZakatPool
        );
        require_eq!(self.pool.status, STATUS_ACTIVE, ZktError::PoolNotActive);

        let now = Clock::get()?.unix_timestamp.get();
        let redistribution_due = i64::from(self.pool.deadline)
            .checked_add(GRACE_PERIOD)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        require!(now > redistribution_due, ZktError::RedistributionNotDue);

        require_keys_eq!(
            self.fallback_ta.owner(),
            self.config.fallback_authority,
            ZktError::InvalidFallbackDestination
        );
        require_keys_eq!(
            self.fallback_ta.mint(),
            self.pool.mint,
            ZktError::InvalidFallbackDestination
        );

        let amount = self.vault.amount();
        require!(amount > 0, ZktError::NothingToRedistribute);

        let organizer = self.pool.organizer;
        let index_bytes = u64::from(self.pool.index).to_le_bytes();
        let bump = [self.pool.bump];
        let seeds = [
            Seed::from(b"pool" as &[u8]),
            Seed::from(organizer.as_ref()),
            Seed::from(index_bytes.as_ref()),
            Seed::from(bump.as_ref()),
        ];

        self.token_program
            .transfer(&self.vault, &self.fallback_ta, &self.pool, amount)
            .invoke_signed(&seeds)?;

        let inner = PoolInner {
            organizer,
            mint: self.pool.mint,
            vault: self.pool.vault,
            index: u64::from(self.pool.index),
            campaign_type: self.pool.campaign_type,
            status: STATUS_CLOSED,
            cap: u64::from(self.pool.cap),
            total_donated: u64::from(self.pool.total_donated),
            created_at: i64::from(self.pool.created_at),
            deadline: i64::from(self.pool.deadline),
            extended: bool::from(self.pool.extended),
            donation_count: u64::from(self.pool.donation_count),
            bump: self.pool.bump,
        };
        self.pool.set_inner(inner);

        emit!(Redistributed {
            pool: *self.pool.address(),
            amount,
            destination: *self.fallback_ta.address(),
        });
        Ok(())
    }
}
