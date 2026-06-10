#![cfg_attr(not(test), no_std)]

use quasar_lang::prelude::*;

mod errors;
mod instructions;
mod state;
use instructions::*;

declare_id!("21D1w3Xi9tyepQN8UijkMEAxXfiaqQaorCqMnuwmmwLC");

#[program]
mod zkt_core {
    use super::*;

    #[instruction]
    pub fn initialize(ctx: Ctx<Initialize>) -> Result<(), ProgramError> {
        ctx.accounts.initialize()
    }
}

#[cfg(test)]
mod tests;
