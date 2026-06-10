use {
    crate::{
        events::{OrganizerRevoked, OrganizerWhitelisted},
        state::{Config, Organizer, OrganizerInner},
    },
    quasar_lang::prelude::*,
};

#[derive(Accounts)]
pub struct WhitelistOrganizer {
    #[account(mut)]
    pub authority: Signer,
    #[account(has_one(authority), address = Config::seeds())]
    pub config: Account<Config>,
    pub wallet: UncheckedAccount,
    #[account(
        init(idempotent),
        payer = authority,
        address = Organizer::seeds(wallet.address()),
    )]
    pub organizer: Account<Organizer>,
    pub system_program: Program<SystemProgram>,
}

impl WhitelistOrganizer {
    #[inline(always)]
    pub fn handler(&mut self, bumps: &WhitelistOrganizerBumps) -> Result<(), ProgramError> {
        let wallet = *self.wallet.address();
        // Preserve pool_count across revoke/re-whitelist cycles (zero when fresh).
        let pool_count = u64::from(self.organizer.pool_count);

        self.organizer.set_inner(OrganizerInner {
            wallet,
            active: true,
            pool_count,
            bump: bumps.organizer,
        });

        emit!(OrganizerWhitelisted { wallet });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RevokeOrganizer {
    pub authority: Signer,
    #[account(has_one(authority), address = Config::seeds())]
    pub config: Account<Config>,
    pub wallet: UncheckedAccount,
    #[account(mut, address = Organizer::seeds(wallet.address()))]
    pub organizer: Account<Organizer>,
}

impl RevokeOrganizer {
    #[inline(always)]
    pub fn handler(&mut self) -> Result<(), ProgramError> {
        let wallet = self.organizer.wallet;
        let pool_count = u64::from(self.organizer.pool_count);
        let bump = self.organizer.bump;

        self.organizer.set_inner(OrganizerInner {
            wallet,
            active: false,
            pool_count,
            bump,
        });

        emit!(OrganizerRevoked { wallet });
        Ok(())
    }
}
