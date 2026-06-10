use quasar_lang::prelude::*;

pub const CAMPAIGN_ZAKAT: u8 = 0;
pub const CAMPAIGN_NORMAL: u8 = 1;

pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_CLOSED: u8 = 1;

/// Zakat distribution window (sharia: zakat must be distributed promptly).
pub const ZAKAT_WINDOW: i64 = 30 * 86_400;
/// Grace period after the deadline before redistribution is allowed.
pub const GRACE_PERIOD: i64 = 7 * 86_400;
/// One-time deadline extension (Phase 1: granted by admin multisig).
pub const EXTENSION: i64 = 14 * 86_400;

#[account(discriminator = 1, set_inner)]
#[seeds(b"config")]
pub struct Config {
    /// Admin authority (Squads multisig vault). Replaceable: see ADR-0003.
    pub authority: Address,
    /// Two-step authority transfer target; all-zero = none pending.
    pub pending_authority: Address,
    /// Owner of the token accounts that receive zakat redistribution.
    pub fallback_authority: Address,
    /// Global ceiling for per-pool caps, in token base units (ADR-0003 ~$300).
    pub max_pool_cap: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account(discriminator = 2, set_inner)]
#[seeds(b"organizer", wallet: Address)]
pub struct Organizer {
    pub wallet: Address,
    pub active: bool,
    /// Sequential pool index; next pool must use this value as its seed.
    pub pool_count: u64,
    pub bump: u8,
}

#[account(discriminator = 3, set_inner)]
#[seeds(b"pool", organizer: Address, index: u64)]
pub struct Pool {
    pub organizer: Address,
    pub mint: Address,
    /// Pool vault = ATA(pool, mint); bound via has_one(vault).
    pub vault: Address,
    pub index: u64,
    pub campaign_type: u8,
    pub status: u8,
    /// Max total donations, in token base units; <= Config.max_pool_cap.
    pub cap: u64,
    pub total_donated: u64,
    pub created_at: i64,
    /// Zakat: distribution deadline (extended in place). Normal: 0 = none.
    pub deadline: i64,
    pub extended: bool,
    pub donation_count: u64,
    pub bump: u8,
}

#[account(discriminator = 4, set_inner)]
#[seeds(b"receipt", pool: Address, index: u64)]
pub struct Receipt {
    pub donor: Address,
    pub pool: Address,
    pub amount: u64,
    pub timestamp: i64,
    pub bump: u8,
}
