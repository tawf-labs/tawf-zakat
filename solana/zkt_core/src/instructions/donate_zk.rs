use {
    crate::{
        errors::ZktError,
        events::ZkDonationReceived,
        state::{
            Config, NullifierRecord, NullifierRecordInner, Pool, PoolInner, CAMPAIGN_ZAKAT,
            MAX_PROOF_AGE, STATUS_ACTIVE,
        },
    },
    quasar_lang::{
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
    quasar_spl::prelude::*,
};

/// Groth16 proof: A (G1, 64) ++ B (G2, 128) ++ C (G1, 64), uncompressed.
pub const PROOF_LEN: usize = 256;

fn be32_u64(v: u64) -> [u8; 32] {
    let mut b = [0u8; 32];
    b[24..].copy_from_slice(&v.to_be_bytes());
    b
}

fn be32_i64(v: i64) -> [u8; 32] {
    let mut b = [0u8; 32];
    b[24..].copy_from_slice(&v.to_be_bytes());
    b
}

/// Groth16 verifier seam (ADR-0004), currently **fail-closed**: every ZK
/// donation is rejected until the verifying key from the trusted-setup ceremony
/// is embedded and the pairing check is wired (vendor groth16-solana with
/// thiserror stripped for no_std, or hand-roll over solana-bn254). The guards
/// in `handler` that run *before* this call (paused, zakat-only, freshness,
/// deadline, cap) are testable today; the post-verify path (transfer + the
/// nullifier replay guard) gets its tests when the verifier lands.
fn verify_eligibility(_proof: &[u8; PROOF_LEN], _signals: &[[u8; 32]; 5]) -> Result<(), ProgramError> {
    Err(ZktError::ZkVerifierNotWired.into())
}

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32])]
pub struct DonateZk {
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
    #[account(init, payer = donor, address = NullifierRecord::seeds(nullifier))]
    pub nullifier_record: Account<NullifierRecord>,
    pub token_program: Program<TokenProgram>,
    pub system_program: Program<SystemProgram>,
}

impl DonateZk {
    pub fn handler(
        &mut self,
        nullifier: [u8; 32],
        nisab: u64,
        current_time: i64,
        cycle_id: u64,
        amount: u64,
        proof: [u8; PROOF_LEN],
        bumps: &DonateZkBumps,
    ) -> Result<(), ProgramError> {
        require!(!bool::from(self.config.paused), ZktError::Paused);
        require!(amount > 0, ZktError::ZeroAmount);
        require_eq!(self.pool.status, STATUS_ACTIVE, ZktError::PoolNotActive);
        // ZK eligibility (nisab/hawl) only certifies *zakat*, so this path is
        // zakat-only; plain campaigns use `donate`.
        require_eq!(
            self.pool.campaign_type,
            CAMPAIGN_ZAKAT,
            ZktError::NotZakatPool
        );

        let now = Clock::get()?.unix_timestamp.get();

        // Proof freshness: current_time must be recent and not in the future,
        // so a stale-but-valid proof can't be replayed long after issuance.
        let age = now
            .checked_sub(current_time)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        require!(age >= 0 && age <= MAX_PROOF_AGE, ZktError::StaleProof);

        // Zakat distribution window.
        require!(
            now <= i64::from(self.pool.deadline),
            ZktError::DonationWindowClosed
        );

        let total_donated = u64::from(self.pool.total_donated)
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        require!(
            total_donated <= u64::from(self.pool.cap),
            ZktError::CapExceeded
        );

        // Public signals in the order snarkjs emits them (output first):
        //   [nullifier, nisab, currentTime, campaignId, cycleId]
        // NOTE: campaignId is bound to pool.index, which is unique only per
        // organizer. Production must bind a collision-free pool identifier (see
        // ADR-0004) before the verifier goes live.
        let pool_index = u64::from(self.pool.index);
        let signals: [[u8; 32]; 5] = [
            nullifier,
            be32_u64(nisab),
            be32_i64(current_time),
            be32_u64(pool_index),
            be32_u64(cycle_id),
        ];
        verify_eligibility(&proof, &signals)?;

        // Move funds only after the proof checks out.
        self.token_program
            .transfer(&self.donor_ta, &self.vault, &self.donor, amount)
            .invoke()?;

        let pool_address = *self.pool.address();

        // Burn the nullifier: this `init` fails if the PDA already exists, which
        // is the on-chain double-zakat guard.
        self.nullifier_record.set_inner(NullifierRecordInner {
            nullifier,
            pool: pool_address,
            amount,
            timestamp: now,
            bump: bumps.nullifier_record,
        });

        let inner = PoolInner {
            organizer: self.pool.organizer,
            mint: self.pool.mint,
            vault: self.pool.vault,
            index: pool_index,
            campaign_type: self.pool.campaign_type,
            status: self.pool.status,
            cap: u64::from(self.pool.cap),
            total_donated,
            created_at: i64::from(self.pool.created_at),
            deadline: i64::from(self.pool.deadline),
            extended: bool::from(self.pool.extended),
            donation_count: u64::from(self.pool.donation_count)
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)?,
            disbursement_count: u64::from(self.pool.disbursement_count),
            bump: self.pool.bump,
        };
        self.pool.set_inner(inner);

        emit!(ZkDonationReceived {
            pool: pool_address,
            nullifier: Address::new_from_array(nullifier),
            amount,
        });
        Ok(())
    }
}
