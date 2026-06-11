#![cfg_attr(not(test), no_std)]

use quasar_lang::prelude::*;

mod errors;
mod events;
mod instructions;
mod state;
use instructions::*;

declare_id!("21D1w3Xi9tyepQN8UijkMEAxXfiaqQaorCqMnuwmmwLC");

#[program]
mod zkt_core {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn init_config(
        ctx: Ctx<InitConfig>,
        fallback_authority: Address,
        max_pool_cap: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .handler(fallback_authority, max_pool_cap, &ctx.bumps)
    }

    #[instruction(discriminator = 1)]
    pub fn set_config(
        ctx: Ctx<SetConfig>,
        fallback_authority: Address,
        max_pool_cap: u64,
        paused: bool,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(fallback_authority, max_pool_cap, paused)
    }

    #[instruction(discriminator = 2)]
    pub fn transfer_authority(
        ctx: Ctx<TransferAuthority>,
        new_authority: Address,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(new_authority)
    }

    #[instruction(discriminator = 3)]
    pub fn accept_authority(ctx: Ctx<AcceptAuthority>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 4)]
    pub fn whitelist_organizer(ctx: Ctx<WhitelistOrganizer>) -> Result<(), ProgramError> {
        ctx.accounts.handler(&ctx.bumps)
    }

    #[instruction(discriminator = 5)]
    pub fn revoke_organizer(ctx: Ctx<RevokeOrganizer>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 6)]
    pub fn create_pool(
        ctx: Ctx<CreatePool>,
        index: u64,
        campaign_type: u8,
        cap: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(index, campaign_type, cap, &ctx.bumps)
    }

    #[instruction(discriminator = 7)]
    pub fn donate(
        ctx: Ctx<Donate>,
        amount: u64,
        receipt_index: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.handler(amount, receipt_index, &ctx.bumps)
    }

    #[instruction(discriminator = 8)]
    pub fn withdraw(ctx: Ctx<Withdraw>, amount: u64) -> Result<(), ProgramError> {
        ctx.accounts.handler(amount)
    }

    #[instruction(discriminator = 9)]
    pub fn extend_deadline(ctx: Ctx<ExtendDeadline>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 10)]
    pub fn redistribute(ctx: Ctx<Redistribute>) -> Result<(), ProgramError> {
        ctx.accounts.handler()
    }

    #[instruction(discriminator = 11)]
    pub fn donate_zk(
        ctx: Ctx<DonateZk>,
        nullifier: [u8; 32],
        nisab: u64,
        current_time: i64,
        cycle_id: u64,
        amount: u64,
        proof: [u8; PROOF_LEN],
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .handler(nullifier, nisab, current_time, cycle_id, amount, proof, &ctx.bumps)
    }
}

#[cfg(test)]
mod tests;
