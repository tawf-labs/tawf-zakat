use {
    crate::{
        errors::ZktError,
        events::Disbursed,
        state::{
            Config, Disbursement, DisbursementInner, Pool, PoolInner, ASNAF_MAX, ASNAF_NA,
            CAMPAIGN_ZAKAT, STATUS_ACTIVE,
        },
    },
    quasar_lang::{
        cpi::Seed,
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
#[instruction(_amount: u64, _asnaf: u8, _recipient_commitment: [u8; 32], disbursement_index: u64)]
pub struct Withdraw {
    #[account(mut)]
    pub organizer: Signer,
    #[account(address = Config::seeds())]
    pub config: Account<Config>,
    #[account(mut, has_one(organizer), has_one(vault))]
    pub pool: Account<Pool>,
    #[account(mut)]
    pub vault: Account<Token>,
    #[account(mut)]
    pub dest_ta: Account<Token>,
    #[account(init, payer = organizer, address = Disbursement::seeds(pool.address(), disbursement_index))]
    pub disbursement: Account<Disbursement>,
    pub token_program: Program<TokenProgram>,
    pub system_program: Program<SystemProgram>,
}

impl Withdraw {
    pub fn handler(
        &mut self,
        amount: u64,
        asnaf: u8,
        recipient_commitment: [u8; 32],
        disbursement_index: u64,
        bumps: &WithdrawBumps,
    ) -> Result<(), ProgramError> {
        // Emergency pause freezes organizer outflow (redistribute stays
        // ungated — it is the sharia safety-valve to the trusted fallback).
        require!(!bool::from(self.config.paused), ZktError::Paused);
        require!(amount > 0, ZktError::ZeroAmount);
        require_eq!(self.pool.status, STATUS_ACTIVE, ZktError::PoolNotActive);

        let now = Clock::get()?.unix_timestamp.get();
        if self.pool.campaign_type == CAMPAIGN_ZAKAT {
            // Zakat must be distributed inside its window, and only to one of the
            // eight lawful asnaf — recorded so the outflow is auditable.
            require!(
                now <= i64::from(self.pool.deadline),
                ZktError::WithdrawWindowClosed
            );
            require!(asnaf <= ASNAF_MAX, ZktError::InvalidAsnaf);
        } else {
            // Normal campaigns have no asnaf classification.
            require!(asnaf == ASNAF_NA, ZktError::InvalidAsnaf);
        }

        // The disbursement receipt PDA is seeded by this index; it must follow
        // the pool's counter so receipts are gapless and the `init` is unique.
        require_eq!(
            disbursement_index,
            u64::from(self.pool.disbursement_count),
            ZktError::InvalidDisbursementIndex
        );

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
            .transfer(&self.vault, &self.dest_ta, &self.pool, amount)
            .invoke_signed(&seeds)?;

        let pool_address = *self.pool.address();

        // Recipient form depends on the campaign (ADR-0006). For zakat, store the
        // amil's off-chain commitment `hash(recipient || salt)` rather than the
        // mustahik's raw wallet, so the durable receipt set never enumerates
        // below-nisab addresses (`hifz al-nafs`); the amil can selectively
        // disclose `(recipient, salt)` to an auditor. (The `dest_ta` transfer
        // target is still in this tx — full unlinkability needs intermediary
        // disbursement, future work.) For a normal campaign the beneficiary is
        // public, so record the raw owner.
        let recipient = if self.pool.campaign_type == CAMPAIGN_ZAKAT {
            Address::new_from_array(recipient_commitment)
        } else {
            *self.dest_ta.owner()
        };

        // Record the distribution: recipient + amount + which asnaf was served.
        self.disbursement.set_inner(DisbursementInner {
            pool: pool_address,
            recipient,
            amount,
            timestamp: now,
            asnaf,
            bump: bumps.disbursement,
        });

        let inner = PoolInner {
            organizer,
            mint: self.pool.mint,
            vault: self.pool.vault,
            index: u64::from(self.pool.index),
            campaign_type: self.pool.campaign_type,
            status: self.pool.status,
            cap: u64::from(self.pool.cap),
            total_donated: u64::from(self.pool.total_donated),
            created_at: i64::from(self.pool.created_at),
            deadline: i64::from(self.pool.deadline),
            extended: bool::from(self.pool.extended),
            donation_count: u64::from(self.pool.donation_count),
            disbursement_count: disbursement_index
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)?,
            bump: self.pool.bump,
        };
        self.pool.set_inner(inner);

        emit!(Disbursed {
            pool: pool_address,
            recipient,
            amount,
            asnaf: asnaf as u64,
            disbursement_index,
        });
        Ok(())
    }
}
