use quasar_lang::prelude::*;

pub const CAMPAIGN_ZAKAT: u8 = 0;
pub const CAMPAIGN_NORMAL: u8 = 1;

pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_CLOSED: u8 = 1;

/// The eight asnaf (Qur'an 9:60) — the only lawful zakat recipients. A zakat
/// disbursement must record which one it served, so the fund flow is auditable
/// end-to-end (donation in -> which asnaf out). See ADR-0005.
pub const ASNAF_FAKIR: u8 = 0;
pub const ASNAF_MISKIN: u8 = 1;
pub const ASNAF_AMIL: u8 = 2;
pub const ASNAF_MUALLAF: u8 = 3;
pub const ASNAF_RIQAB: u8 = 4;
pub const ASNAF_GHARIM: u8 = 5;
pub const ASNAF_FISABILILLAH: u8 = 6;
pub const ASNAF_IBNU_SABIL: u8 = 7;
/// Highest valid asnaf code (inclusive).
pub const ASNAF_MAX: u8 = ASNAF_IBNU_SABIL;
/// Sentinel recorded for non-zakat (normal) campaign disbursements, where the
/// asnaf classification does not apply.
pub const ASNAF_NA: u8 = 255;

/// Zakat distribution window (sharia: zakat must be distributed promptly).
pub const ZAKAT_WINDOW: i64 = 30 * 86_400;
/// Grace period after the deadline before redistribution is allowed.
pub const GRACE_PERIOD: i64 = 7 * 86_400;
/// One-time deadline extension (Phase 1: granted by admin multisig).
pub const EXTENSION: i64 = 14 * 86_400;

/// Max age of an eligibility proof's `current_time` public input vs the
/// on-chain clock (anti-replay of a stale-but-valid proof timestamp).
pub const MAX_PROOF_AGE: i64 = 300; // 5 minutes

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
    /// Sequential disbursement index; next disbursement uses this as its seed.
    pub disbursement_count: u64,
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

/// On-chain record of a single distribution. Mirrors `Receipt` on the inflow
/// side so the fund flow is auditable end-to-end: every `withdraw` mints one,
/// binding recipient + amount + which of the eight asnaf was served. The
/// auditable amount/asnaf/counter serve `hifz al-mal` (ADR-0005); the recipient
/// form below serves `hifz al-nafs` (ADR-0006).
#[account(discriminator = 6, set_inner)]
#[seeds(b"disbursement", pool: Address, index: u64)]
pub struct Disbursement {
    pub pool: Address,
    /// Normal campaign: the beneficiary's wallet (owner of the destination token
    /// account) — public, no dignity concern. Zakat pool: an off-chain
    /// commitment `hash(recipient || salt)` instead of the raw wallet, so the
    /// durable, queryable receipt set never enumerates mustahik (below-nisab)
    /// addresses — `hifz al-nafs` (ADR-0006). `asnaf` disambiguates which form
    /// this holds (a real 0-7 code ⇒ commitment; `ASNAF_NA` ⇒ raw wallet).
    pub recipient: Address,
    pub amount: u64,
    pub timestamp: i64,
    /// One of the eight asnaf (0-7) for zakat; `ASNAF_NA` for normal campaigns.
    pub asnaf: u8,
    pub bump: u8,
}

/// Anti-double-zakat record for the ZK donation flow. Its PDA is seeded by the
/// proof's `nullifier` public signal, so `init` fails on a second use of the
/// same nullifier — that is the on-chain replay guard. The nullifier is a BN254
/// field element serialized big-endian into 32 raw bytes (a `[u8; 32]` seed, by
/// value — not an `Address`, whose seed form borrows an account).
#[account(discriminator = 5, set_inner)]
#[seeds(b"nullifier", nullifier: [u8; 32])]
pub struct NullifierRecord {
    pub nullifier: [u8; 32],
    pub pool: Address,
    pub amount: u64,
    pub timestamp: i64,
    pub bump: u8,
}
