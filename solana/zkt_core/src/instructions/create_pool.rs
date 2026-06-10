use {
    crate::{
        errors::ZktError,
        events::PoolCreated,
        state::{
            Config, Organizer, OrganizerInner, Pool, PoolInner, CAMPAIGN_NORMAL, CAMPAIGN_ZAKAT,
            STATUS_ACTIVE, ZAKAT_WINDOW,
        },
    },
    quasar_lang::{
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CreatePool {
    #[account(mut)]
    pub organizer: Signer,
    #[account(address = Config::seeds())]
    pub config: Account<Config>,
    #[account(mut, address = Organizer::seeds(organizer.address()))]
    pub organizer_account: Account<Organizer>,
    pub mint: Account<Mint>,
    #[account(init, payer = organizer, address = Pool::seeds(organizer.address(), index))]
    pub pool: Account<Pool>,
    #[account(
        mut,
        init,
        payer = organizer,
        associated_token(authority = pool, mint = mint, token_program = token_program, system_program = system_program, ata_program = ata_program),
    )]
    pub vault: Account<Token>,
    pub token_program: Program<TokenProgram>,
    pub system_program: Program<SystemProgram>,
    pub ata_program: Program<AssociatedTokenProgram>,
}

impl CreatePool {
    pub fn handler(
        &mut self,
        index: u64,
        campaign_type: u8,
        cap: u64,
        bumps: &CreatePoolBumps,
    ) -> Result<(), ProgramError> {
        require!(!bool::from(self.config.paused), ZktError::Paused);
        require!(
            bool::from(self.organizer_account.active),
            ZktError::OrganizerInactive
        );
        require_eq!(
            index,
            u64::from(self.organizer_account.pool_count),
            ZktError::InvalidPoolIndex
        );
        require!(
            campaign_type == CAMPAIGN_ZAKAT || campaign_type == CAMPAIGN_NORMAL,
            ZktError::InvalidCampaignType
        );
        require!(
            cap > 0 && cap <= u64::from(self.config.max_pool_cap),
            ZktError::InvalidCap
        );

        let now = Clock::get()?.unix_timestamp.get();
        let deadline = if campaign_type == CAMPAIGN_ZAKAT {
            now.checked_add(ZAKAT_WINDOW)
                .ok_or(ProgramError::ArithmeticOverflow)?
        } else {
            0
        };

        let organizer = *self.organizer.address();
        let mint = *self.mint.address();

        self.pool.set_inner(PoolInner {
            organizer,
            mint,
            vault: *self.vault.address(),
            index,
            campaign_type,
            status: STATUS_ACTIVE,
            cap,
            total_donated: 0,
            created_at: now,
            deadline,
            extended: false,
            donation_count: 0,
            bump: bumps.pool,
        });

        let wallet = self.organizer_account.wallet;
        let org_bump = self.organizer_account.bump;
        self.organizer_account.set_inner(OrganizerInner {
            wallet,
            active: true,
            pool_count: index
                .checked_add(1)
                .ok_or(ProgramError::ArithmeticOverflow)?,
            bump: org_bump,
        });

        emit!(PoolCreated {
            pool: *self.pool.address(),
            organizer,
            mint,
            index,
            campaign_type: campaign_type as u64,
            cap,
            deadline,
        });
        Ok(())
    }
}
