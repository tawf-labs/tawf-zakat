use quasar_lang::prelude::*;

#[error_code]
pub enum ZktError {
    Unauthorized = 6000,
    Paused,
    OrganizerInactive,
    InvalidCampaignType,
    InvalidCap,
    CapExceeded,
    PoolNotActive,
    DonationWindowClosed,
    WithdrawWindowClosed,
    NotZakatPool,
    AlreadyExtended,
    ExtensionWindowClosed,
    RedistributionNotDue,
    NothingToRedistribute,
    InvalidFallbackDestination,
    InvalidPoolIndex,
    InvalidReceiptIndex,
    NoPendingAuthority,
    ZeroAmount,
    /// Eligibility proof's `current_time` is too far from the on-chain clock.
    StaleProof,
    /// donate_zk's Groth16 verifier is not wired yet (fail-closed). Production
    /// builds reject all ZK donations until the verifying key is embedded.
    ZkVerifierNotWired,
    /// The Groth16 proof failed verification.
    ProofInvalid,
}
