use {
    crate::{
        errors::ZktError,
        events::ZkDonationReceived,
        groth16::{negate_g1, Groth16Verifier, Groth16Verifyingkey},
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

/// Derive the circuit's `campaignId` public signal from a pool's PDA address.
/// The pool address is globally unique (PDA of `[b"pool", organizer, index]`),
/// unlike `pool.index` which repeats across organizers. Clearing the
/// most-significant byte keeps the big-endian 32-byte value below the BN254
/// scalar-field modulus (~2^253.6), so it is a valid field element. The
/// off-chain prover MUST derive `campaignId` identically from the pool address.
fn campaign_id_from_pool(pool: &Address) -> [u8; 32] {
    let mut id = *pool.as_array();
    id[0] = 0;
    id
}

/// The trusted-setup ceremony's verifying key, embedded at build time.
///
/// `None` keeps `donate_zk` **fail-closed**: every ZK donation is rejected until
/// the Phase-2 ceremony runs and its key is pasted here (ADR-0004). The verifier
/// itself is wired and unit-tested (`crate::groth16`); only the key is missing.
///
/// To go live, freeze the circuit, run the ceremony, convert
/// `verification_key.json` to this byte layout, and replace `None` with:
/// ```ignore
/// const VK_IC: [[u8; 64]; 6] = [/* one per public signal + 1 */];
/// const VERIFYING_KEY: Option<Groth16Verifyingkey<'static>> =
///     Some(Groth16Verifyingkey { nr_pubinputs: 6, vk_alpha_g1: [..], vk_beta_g2: [..],
///         vk_gamme_g2: [..], vk_delta_g2: [..], vk_ic: &VK_IC });
/// ```
const VERIFYING_KEY: Option<Groth16Verifyingkey<'static>> = None;

/// Groth16 verifier seam (ADR-0004). Fail-closed while `VERIFYING_KEY` is `None`.
/// Proof layout: A (G1, 64) ++ B (G2, 128) ++ C (G1, 64), big-endian; A is
/// negated on-chain as Groth16's pairing check requires.
fn verify_eligibility(proof: &[u8; PROOF_LEN], signals: &[[u8; 32]; 5]) -> Result<(), ProgramError> {
    let vk = match &VERIFYING_KEY {
        Some(vk) => vk,
        None => return Err(ZktError::ZkVerifierNotWired.into()),
    };
    let proof_a: [u8; 64] = proof[0..64].try_into().unwrap();
    let proof_a_neg = negate_g1(&proof_a);
    let proof_b: [u8; 128] = proof[64..192].try_into().unwrap();
    let proof_c: [u8; 64] = proof[192..256].try_into().unwrap();
    let mut verifier = Groth16Verifier::new(&proof_a_neg, &proof_b, &proof_c, signals, vk)
        .map_err(|_| ZktError::ProofInvalid)?;
    verifier.verify().map_err(|_| ZktError::ProofInvalid)?;
    Ok(())
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
        // campaignId binds the proof to THIS pool via its globally-unique PDA
        // address, so a proof for one organizer's pool cannot be replayed against
        // another's (pool.index alone is unique only per organizer). Resolves the
        // provisional binding flagged in ADR-0004.
        let campaign_id = campaign_id_from_pool(self.pool.address());
        let signals: [[u8; 32]; 5] = [
            nullifier,
            be32_u64(nisab),
            be32_i64(current_time),
            campaign_id,
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
            index: u64::from(self.pool.index),
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
