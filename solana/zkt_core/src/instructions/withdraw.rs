use {
    crate::{
        errors::ZktError,
        events::Withdrawn,
        state::{Pool, CAMPAIGN_ZAKAT, STATUS_ACTIVE},
    },
    quasar_lang::{
        cpi::Seed,
        prelude::*,
        sysvars::{clock::Clock, Sysvar as _},
    },
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
pub struct Withdraw {
    pub organizer: Signer,
    #[account(mut, has_one(organizer), has_one(vault))]
    pub pool: Account<Pool>,
    #[account(mut)]
    pub vault: Account<Token>,
    #[account(mut)]
    pub dest_ta: Account<Token>,
    pub token_program: Program<TokenProgram>,
}

impl Withdraw {
    pub fn handler(&mut self, amount: u64) -> Result<(), ProgramError> {
        require!(amount > 0, ZktError::ZeroAmount);
        require_eq!(self.pool.status, STATUS_ACTIVE, ZktError::PoolNotActive);

        if self.pool.campaign_type == CAMPAIGN_ZAKAT {
            let now = Clock::get()?.unix_timestamp.get();
            require!(
                now <= i64::from(self.pool.deadline),
                ZktError::WithdrawWindowClosed
            );
        }

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

        emit!(Withdrawn {
            pool: *self.pool.address(),
            organizer,
            amount,
        });
        Ok(())
    }
}
