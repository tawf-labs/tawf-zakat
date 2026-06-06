use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_ZKAT_ELIGIBILITY: u32 = comp_def_offset("check_zkat_eligibility");
const COMP_DEF_OFFSET_VOTE_AGGREGATION: u32 = comp_def_offset("aggregate_votes");
const COMP_DEF_OFFSET_PRIVATE_DONATION: u32 = comp_def_offset("process_private_donation");

declare_id!("EpT68DDpM3sasCBqw7VBp7XrKPv7mGQx9sy2JNdXciaD");

#[arcium_program]
pub mod zkt_hackathon_solana {
    use super::*;

    // ============================================================
    // Initialization instructions (called once per MXE)
    // ============================================================

    pub fn init_zkat_eligibility_comp_def(ctx: Context<InitZkatEligibilityCompDef>) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    pub fn init_vote_aggregation_comp_def(ctx: Context<InitVoteAggregationCompDef>) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    pub fn init_private_donation_comp_def(ctx: Context<InitPrivateDonationCompDef>) -> Result<()> {
        init_computation_def(ctx.accounts, None)?;
        Ok(())
    }

    // ============================================================
    // Confidential instruction: Zakat Eligibility Check
    // ============================================================

    pub fn check_zkat_eligibility(
        ctx: Context<CheckZkatEligibility>,
        computation_offset: u64,
        ciphertext_income: [u8; 32],
        ciphertext_assets: [u8; 32],
        ciphertext_hawl_start: [u8; 32],
        ciphertext_secret: [u8; 32],
        ciphertext_amount: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        nisab_threshold: u64,
        current_time: u64,
        recipient_0: u64,
        recipient_1: u64,
        cycle_id: u64,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u8(ciphertext_income)
            .encrypted_u8(ciphertext_assets)
            .encrypted_u8(ciphertext_hawl_start)
            .encrypted_u8(ciphertext_secret)
            .encrypted_u8(ciphertext_amount)
            .plaintext_u64(nisab_threshold)
            .plaintext_u64(current_time)
            .plaintext_u64(recipient_0)
            .plaintext_u64(recipient_1)
            .plaintext_u64(cycle_id)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CheckZkatEligibilityCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "check_zkat_eligibility")]
    pub fn check_zkat_eligibility_callback(
        ctx: Context<CheckZkatEligibilityCallback>,
        output: SignedComputationOutputs<CheckZkatEligibilityOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckZkatEligibilityOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Error: {}", e);
                return Err(ErrorCode::AbortedComputation.into())
            }
        };

        emit!(ZkatEligibilityEvent {
            eligible: o.ciphertexts[0],
            nullifier_0: o.ciphertexts[1],
            nullifier_1: o.ciphertexts[2],
            amount_commitment_0: o.ciphertexts[3],
            amount_commitment_1: o.ciphertexts[4],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }

    // ============================================================
    // Confidential instruction: Vote Aggregation
    // ============================================================

    pub fn aggregate_votes(
        ctx: Context<AggregateVotes>,
        computation_offset: u64,
        ciphertext_votes: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        proposal_id: u64,
        quorum_threshold: u8,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u8(ciphertext_votes)
            .plaintext_u64(proposal_id)
            .plaintext_u8(quorum_threshold)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![AggregateVotesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "aggregate_votes")]
    pub fn aggregate_votes_callback(
        ctx: Context<AggregateVotesCallback>,
        output: SignedComputationOutputs<AggregateVotesOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(AggregateVotesOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Error: {}", e);
                return Err(ErrorCode::AbortedComputation.into())
            }
        };

        emit!(VoteAggregationEvent {
            quorum_met: o.ciphertexts[0],
            total_weight: o.ciphertexts[1],
            approval_count: o.ciphertexts[2],
            proposal_id: o.ciphertexts[3],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }

    // ============================================================
    // Confidential instruction: Private Donation
    // ============================================================

    pub fn process_private_donation(
        ctx: Context<ProcessPrivateDonation>,
        computation_offset: u64,
        ciphertext_donor_0: [u8; 32],
        ciphertext_donor_1: [u8; 32],
        ciphertext_amount: [u8; 32],
        ciphertext_commitment_0: [u8; 32],
        ciphertext_commitment_1: [u8; 32],
        ciphertext_timestamp: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        pool_id: u64,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u8(ciphertext_donor_0)
            .encrypted_u8(ciphertext_donor_1)
            .encrypted_u8(ciphertext_amount)
            .encrypted_u8(ciphertext_commitment_0)
            .encrypted_u8(ciphertext_commitment_1)
            .encrypted_u8(ciphertext_timestamp)
            .plaintext_u64(pool_id)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![ProcessPrivateDonationCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "process_private_donation")]
    pub fn process_private_donation_callback(
        ctx: Context<ProcessPrivateDonationCallback>,
        output: SignedComputationOutputs<ProcessPrivateDonationOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ProcessPrivateDonationOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("Error: {}", e);
                return Err(ErrorCode::AbortedComputation.into())
            }
        };

        emit!(PrivateDonationEvent {
            receipt_hash_0: o.ciphertexts[0],
            receipt_hash_1: o.ciphertexts[1],
            pool_id: o.ciphertexts[2],
            timestamp: o.ciphertexts[3],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }
}

// ============================================================
// Account structs: Zakat Eligibility
// ============================================================

#[queue_computation_accounts("check_zkat_eligibility", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckZkatEligibility<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ZKAT_ELIGIBILITY))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("check_zkat_eligibility")]
#[derive(Accounts)]
pub struct CheckZkatEligibilityCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ZKAT_ELIGIBILITY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[init_computation_definition_accounts("check_zkat_eligibility", payer)]
#[derive(Accounts)]
pub struct InitZkatEligibilityCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ============================================================
// Account structs: Vote Aggregation
// ============================================================

#[queue_computation_accounts("aggregate_votes", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AggregateVotes<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VOTE_AGGREGATION))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("aggregate_votes")]
#[derive(Accounts)]
pub struct AggregateVotesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VOTE_AGGREGATION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[init_computation_definition_accounts("aggregate_votes", payer)]
#[derive(Accounts)]
pub struct InitVoteAggregationCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ============================================================
// Account structs: Private Donation
// ============================================================

#[queue_computation_accounts("process_private_donation", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ProcessPrivateDonation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PRIVATE_DONATION))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("process_private_donation")]
#[derive(Accounts)]
pub struct ProcessPrivateDonationCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PRIVATE_DONATION))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[init_computation_definition_accounts("process_private_donation", payer)]
#[derive(Accounts)]
pub struct InitPrivateDonationCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ============================================================
// Events
// ============================================================

#[event]
pub struct ZkatEligibilityEvent {
    pub eligible: [u8; 32],
    pub nullifier_0: [u8; 32],
    pub nullifier_1: [u8; 32],
    pub amount_commitment_0: [u8; 32],
    pub amount_commitment_1: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct VoteAggregationEvent {
    pub quorum_met: [u8; 32],
    pub total_weight: [u8; 32],
    pub approval_count: [u8; 32],
    pub proposal_id: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct PrivateDonationEvent {
    pub receipt_hash_0: [u8; 32],
    pub receipt_hash_1: [u8; 32],
    pub pool_id: [u8; 32],
    pub timestamp: [u8; 32],
    pub nonce: [u8; 16],
}

// ============================================================
// Errors
// ============================================================

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
}
