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
}
