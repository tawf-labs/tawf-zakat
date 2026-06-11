use quasar_lang::prelude::*;

#[event(discriminator = 0)]
pub struct ConfigInitialized {
    pub authority: Address,
    pub fallback_authority: Address,
    pub max_pool_cap: u64,
}

#[event(discriminator = 1)]
pub struct ConfigUpdated {
    pub fallback_authority: Address,
    pub max_pool_cap: u64,
    /// 0 or 1 (bool widened: event layout must be padding-free)
    pub paused: u64,
}

#[event(discriminator = 2)]
pub struct AuthorityTransferStarted {
    pub current: Address,
    pub pending: Address,
}

#[event(discriminator = 3)]
pub struct AuthorityTransferred {
    pub previous: Address,
    pub new: Address,
}

#[event(discriminator = 4)]
pub struct OrganizerWhitelisted {
    pub wallet: Address,
}

#[event(discriminator = 5)]
pub struct OrganizerRevoked {
    pub wallet: Address,
}

#[event(discriminator = 6)]
pub struct PoolCreated {
    pub pool: Address,
    pub organizer: Address,
    pub mint: Address,
    pub index: u64,
    /// CAMPAIGN_* constant (u8 widened: event layout must be padding-free)
    pub campaign_type: u64,
    pub cap: u64,
    pub deadline: i64,
}

#[event(discriminator = 7)]
pub struct DonationReceived {
    pub pool: Address,
    pub donor: Address,
    pub amount: u64,
    pub receipt_index: u64,
}

#[event(discriminator = 8)]
pub struct Withdrawn {
    pub pool: Address,
    pub organizer: Address,
    pub amount: u64,
}

#[event(discriminator = 9)]
pub struct DeadlineExtended {
    pub pool: Address,
    pub new_deadline: i64,
}

#[event(discriminator = 10)]
pub struct Redistributed {
    pub pool: Address,
    pub amount: u64,
    pub destination: Address,
}

/// ZK donation. Deliberately omits the donor to keep the flow privacy-leaning
/// (Layer A is pseudonymous; the donor still signs the tx). The nullifier is
/// the BN254 field element (big-endian) that gated this donation.
#[event(discriminator = 11)]
pub struct ZkDonationReceived {
    pub pool: Address,
    /// BN254 field element (big-endian) as a 32-byte container.
    pub nullifier: Address,
    pub amount: u64,
}
