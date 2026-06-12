use {
    crate::{
        errors::ZktError,
        events::DonationReceived,
        state::{
            Config, Pool, PoolInner, Receipt, ReceiptInner, CAMPAIGN_ZAKAT, STATUS_ACTIVE,
        },
    },
    quasar_lang::{
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
#[instruction(_amount: u64, receipt_index: u64)]
pub struct Donate {
    #[account(mut)]
    pub donor: Signer,
    #[account(address = Config::seeds())]
    pub config: Account<Config>,
    #[account(mut, has_one(vault))]
    pub pool: Account<Pool>,
    #[account(mut)]
    pub vault: Account<Token>,
    #[account(mut)]
    pub donor_ta: Account<Token>,
    #[account(init, payer = donor, address = Receipt::seeds(pool.address(), receipt_index))]
    pub receipt: Account<Receipt>,
    pub token_program: Program<TokenProgram>,
    pub system_program: Program<SystemProgram>,
}

impl Donate {
    pub fn handler(
        &mut self,
        amount: u64,
        receipt_index: u64,
        bumps: &DonateBumps,
    ) -> Result<(), ProgramError> {
        require!(!bool::from(self.config.paused), ZktError::Paused);
        require!(amount > 0, ZktError::ZeroAmount);
        require_eq!(self.pool.status, STATUS_ACTIVE, ZktError::PoolNotActive);
        require_eq!(
            receipt_index,
            u64::from(self.pool.donation_count),
            ZktError::InvalidReceiptIndex
        );

        let now = Clock::get()?.unix_timestamp.get();
        if self.pool.campaign_type == CAMPAIGN_ZAKAT {
            require!(
                now <= i64::from(self.pool.deadline),
                ZktError::DonationWindowClosed
            );
        }

        let total_donated = u64::from(self.pool.total_donated)
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        require!(
            total_donated <= u64::from(self.pool.cap),
            ZktError::CapExceeded
        );

        self.token_program
            .transfer(&self.donor_ta, &self.vault, &self.donor, amount)
            .invoke()?;

        let donor = *self.donor.address();
        let pool_address = *self.pool.address();

        self.receipt.set_inner(ReceiptInner {
            donor,
            pool: pool_address,
            amount,
            timestamp: now,
            bump: bumps.receipt,
        });

        let inner = PoolInner {
            organizer: self.pool.organizer,
            mint: self.pool.mint,
            vault: self.pool.vault,
            index: u64::from(self.pool.index),
            campaign_type: self.pool.campaign_type,
            status: self.pool.status,
            cap: u64::from(self.pool.cap),
            total_donated,
            created_at: i64::from(self.pool.created_at),
            deadline: i64::from(self.pool.deadline),
            extended: bool::from(self.pool.extended),
            donation_count: receipt_index
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)?,
            disbursement_count: u64::from(self.pool.disbursement_count),
            bump: self.pool.bump,
        };
        self.pool.set_inner(inner);

        emit!(DonationReceived {
            pool: pool_address,
            donor,
            amount,
            receipt_index,
        });
        Ok(())
    }
}
