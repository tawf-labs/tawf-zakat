use anchor_lang::prelude::*;

declare_id!("HurjsoDphK87BtzNMUFZJUUGbxYe6fYxdtTAz3RXy9e4");

#[program]
pub mod zkt_core {
    use super::*;

    pub fn apply_as_organizer(
        ctx: Context<ApplyAsOrganizer>,
        metadata_uri: String,
    ) -> Result<()> {
        let state = &mut ctx.accounts.organizer_state;
        state.organizer = ctx.accounts.applicant.key();
        state.metadata_uri = metadata_uri.clone();
        state.status = OrganizerStatus::Pending;
        state.bump = ctx.bumps.organizer_state;

        emit!(OrganizerApplied {
            applicant: state.organizer,
            metadata_uri,
        });
        Ok(())
    }

    pub fn review_organizer(ctx: Context<ReviewOrganizer>, approved: bool) -> Result<()> {
        let state = &mut ctx.accounts.organizer_state;
        state.status = if approved { OrganizerStatus::Approved } else { OrganizerStatus::Rejected };
        emit!(OrganizerReviewed {
            applicant: state.organizer,
            reviewer: ctx.accounts.reviewer.key(),
            approved,
        });
        Ok(())
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        title: String,
        description: String,
        funding_goal: u64,
    ) -> Result<()> {
        let p = &mut ctx.accounts.proposal;
        p.organizer = ctx.accounts.organizer.key();
        p.title = title.clone();
        p.description = description.clone();
        p.funding_goal = funding_goal;
        p.status = ProposalStatus::Voting;
        p.bump = ctx.bumps.proposal;

        emit!(ProposalCreated { proposal: p.key(), organizer: p.organizer, title, description });
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, support: bool) -> Result<()> {
        let vote = &mut ctx.accounts.vote;
        vote.voter = ctx.accounts.voter.key();
        vote.proposal = ctx.accounts.proposal.key();
        vote.support = support;
        vote.bump = ctx.bumps.vote;

        if support { ctx.accounts.proposal.votes_for += 1; }
        else { ctx.accounts.proposal.votes_against += 1; }

        emit!(VoteCast { voter: vote.voter, proposal: vote.proposal, support });
        Ok(())
    }

    pub fn finalize_vote(ctx: Context<FinalizeProposalVote>) -> Result<()> {
        let p = &mut ctx.accounts.proposal;
        let total = p.votes_for + p.votes_against;
        p.status = if p.votes_for > total / 2 { ProposalStatus::Approved } else { ProposalStatus::Rejected };
        emit!(VoteFinalized { proposal: p.key(), votes_for: p.votes_for, votes_against: p.votes_against });
        Ok(())
    }

    pub fn submit_milestone_vote(
        ctx: Context<SubmitMilestoneVote>,
        milestone_id: u64,
        support: bool,
    ) -> Result<()> {
        let mv = &mut ctx.accounts.milestone_vote;
        mv.voter = ctx.accounts.voter.key();
        mv.proposal = ctx.accounts.proposal.key();
        mv.milestone_id = milestone_id;
        mv.support = support;
        mv.bump = ctx.bumps.milestone_vote;

        emit!(MilestoneVoteCast { voter: mv.voter, proposal: mv.proposal, milestone_id, support });
        Ok(())
    }

    pub fn create_campaign_pool(ctx: Context<CreatePool>, funding_goal: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.organizer = ctx.accounts.organizer.key();
        pool.funding_goal = funding_goal;
        pool.raised_amount = 0;
        pool.bump = ctx.bumps.pool;

        emit!(CampaignPoolCreated { pool: pool.key(), organizer: pool.organizer, funding_goal });
        Ok(())
    }

    pub fn donate(ctx: Context<DonateToPool>, amount: u64) -> Result<()> {
        ctx.accounts.pool.raised_amount += amount;
        let dr = &mut ctx.accounts.donor_record;
        dr.donor = ctx.accounts.donor.key();
        dr.pool = ctx.accounts.pool.key();
        dr.amount += amount;
        dr.bump = ctx.bumps.donor_record;

        emit!(DonationReceived { donor: dr.donor, pool: dr.pool, amount });
        Ok(())
    }

    pub fn create_zakat_pool(ctx: Context<CreateZakatPool>, funding_goal: u64) -> Result<()> {
        let pool = &mut ctx.accounts.zakat_pool;
        pool.organizer = ctx.accounts.organizer.key();
        pool.funding_goal = funding_goal;
        pool.raised_amount = 0;
        pool.deadline = Clock::get()?.unix_timestamp + 30 * 24 * 3600;
        pool.bump = ctx.bumps.zakat_pool;

        emit!(ZakatPoolCreated { pool: pool.key(), organizer: pool.organizer, funding_goal });
        Ok(())
    }

    pub fn donate_zakat(ctx: Context<DonateToZakatPool>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.zakat_pool;
        require!(Clock::get()?.unix_timestamp < pool.deadline, ZktCoreError::DeadlineExceeded);
        pool.raised_amount += amount;

        emit!(DonationReceived { donor: ctx.accounts.donor.key(), pool: pool.key(), amount });
        Ok(())
    }

    pub fn submit_sharia_review(
        ctx: Context<SubmitShariaReview>,
        proposal_id: Pubkey,
        metadata_uri: String,
    ) -> Result<()> {
        let r = &mut ctx.accounts.review;
        r.proposal_id = proposal_id;
        r.proposer = ctx.accounts.proposer.key();
        r.metadata_uri = metadata_uri;
        r.status = ReviewStatus::Pending;
        r.bump = ctx.bumps.review;

        emit!(ShariaReviewSubmitted { proposal_id, proposer: r.proposer });
        Ok(())
    }

    pub fn review_sharia(ctx: Context<ReviewShariaAccount>, approved: bool) -> Result<()> {
        let r = &mut ctx.accounts.review;
        r.status = if approved { ReviewStatus::Approved } else { ReviewStatus::Rejected };

        emit!(ShariaReviewFinalized { proposal_id: r.proposal_id, reviewer: ctx.accounts.reviewer.key(), approved });
        Ok(())
    }
}

// ============================================================
// Account contexts (every struct needs at least one PDA)
// ============================================================

#[derive(Accounts)]
pub struct ApplyAsOrganizer<'info> {
    #[account(mut)]
    pub applicant: Signer<'info>,
    #[account(init, payer = applicant, space = 8 + OrganizerState::INIT_SPACE, seeds = [b"organizer", applicant.key().as_ref()], bump)]
    pub organizer_state: Account<'info, OrganizerState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReviewOrganizer<'info> {
    pub reviewer: Signer<'info>,
    #[account(mut, seeds = [b"organizer", organizer_state.organizer.as_ref()], bump = organizer_state.bump)]
    pub organizer_state: Account<'info, OrganizerState>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,
    #[account(init, payer = organizer, space = 8 + Proposal::INIT_SPACE, seeds = [b"proposal", organizer.key().as_ref()], bump)]
    pub proposal: Account<'info, Proposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(mut, seeds = [b"proposal", proposal.organizer.as_ref()], bump = proposal.bump)]
    pub proposal: Account<'info, Proposal>,
    #[account(init, payer = voter, space = 8 + Vote::INIT_SPACE, seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()], bump)]
    pub vote: Account<'info, Vote>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeProposalVote<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"proposal", proposal.organizer.as_ref()], bump = proposal.bump)]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct SubmitMilestoneVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(mut, seeds = [b"proposal", proposal.organizer.as_ref()], bump = proposal.bump)]
    pub proposal: Account<'info, Proposal>,
    #[account(init, payer = voter, space = 8 + MilestoneVote::INIT_SPACE, seeds = [b"mvote", proposal.key().as_ref(), voter.key().as_ref()], bump)]
    pub milestone_vote: Account<'info, MilestoneVote>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,
    #[account(init, payer = organizer, space = 8 + CampaignPool::INIT_SPACE, seeds = [b"pool", organizer.key().as_ref()], bump)]
    pub pool: Account<'info, CampaignPool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DonateToPool<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.organizer.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, CampaignPool>,
    #[account(init_if_needed, payer = donor, space = 8 + DonorRecord::INIT_SPACE, seeds = [b"donor", pool.key().as_ref(), donor.key().as_ref()], bump)]
    pub donor_record: Account<'info, DonorRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateZakatPool<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,
    #[account(init, payer = organizer, space = 8 + ZakatPool::INIT_SPACE, seeds = [b"zakat", organizer.key().as_ref()], bump)]
    pub zakat_pool: Account<'info, ZakatPool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DonateToZakatPool<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut, seeds = [b"zakat", zakat_pool.organizer.as_ref()], bump = zakat_pool.bump)]
    pub zakat_pool: Account<'info, ZakatPool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitShariaReview<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(init, payer = proposer, space = 8 + Review::INIT_SPACE, seeds = [b"review", proposer.key().as_ref()], bump)]
    pub review: Account<'info, Review>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReviewShariaAccount<'info> {
    pub reviewer: Signer<'info>,
    #[account(mut, seeds = [b"review", review.proposer.as_ref()], bump = review.bump)]
    pub review: Account<'info, Review>,
}

// ============================================================
// State
// ============================================================

#[account]
#[derive(InitSpace)]
pub struct OrganizerState { pub organizer: Pubkey, #[max_len(256)] pub metadata_uri: String, pub status: OrganizerStatus, pub bump: u8 }
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum OrganizerStatus { Pending, Approved, Rejected }

#[account]
#[derive(InitSpace)]
pub struct Proposal { pub organizer: Pubkey, #[max_len(128)] pub title: String, #[max_len(512)] pub description: String, pub funding_goal: u64, pub votes_for: u64, pub votes_against: u64, pub status: ProposalStatus, pub bump: u8 }
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ProposalStatus { Draft, Voting, Approved, Rejected, Completed }

#[account]
#[derive(InitSpace)]
pub struct Vote { pub voter: Pubkey, pub proposal: Pubkey, pub support: bool, pub bump: u8 }

#[account]
#[derive(InitSpace)]
pub struct MilestoneVote { pub voter: Pubkey, pub proposal: Pubkey, pub milestone_id: u64, pub support: bool, pub bump: u8 }

#[account]
#[derive(InitSpace)]
pub struct CampaignPool { pub organizer: Pubkey, pub funding_goal: u64, pub raised_amount: u64, pub bump: u8 }

#[account]
#[derive(InitSpace)]
pub struct DonorRecord { pub donor: Pubkey, pub pool: Pubkey, pub amount: u64, pub bump: u8 }

#[account]
#[derive(InitSpace)]
pub struct ZakatPool { pub organizer: Pubkey, pub funding_goal: u64, pub raised_amount: u64, pub deadline: i64, pub bump: u8 }

#[account]
#[derive(InitSpace)]
pub struct Review { pub proposal_id: Pubkey, pub proposer: Pubkey, #[max_len(256)] pub metadata_uri: String, pub status: ReviewStatus, pub bump: u8 }
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ReviewStatus { Pending, Approved, Rejected }

// ============================================================
// Events
// ============================================================

#[event] pub struct OrganizerApplied { pub applicant: Pubkey, pub metadata_uri: String }
#[event] pub struct OrganizerReviewed { pub applicant: Pubkey, pub reviewer: Pubkey, pub approved: bool }
#[event] pub struct ProposalCreated { pub proposal: Pubkey, pub organizer: Pubkey, pub title: String, pub description: String }
#[event] pub struct VoteCast { pub voter: Pubkey, pub proposal: Pubkey, pub support: bool }
#[event] pub struct VoteFinalized { pub proposal: Pubkey, pub votes_for: u64, pub votes_against: u64 }
#[event] pub struct MilestoneVoteCast { pub voter: Pubkey, pub proposal: Pubkey, pub milestone_id: u64, pub support: bool }
#[event] pub struct CampaignPoolCreated { pub pool: Pubkey, pub organizer: Pubkey, pub funding_goal: u64 }
#[event] pub struct ZakatPoolCreated { pub pool: Pubkey, pub organizer: Pubkey, pub funding_goal: u64 }
#[event] pub struct DonationReceived { pub donor: Pubkey, pub pool: Pubkey, pub amount: u64 }
#[event] pub struct ShariaReviewSubmitted { pub proposal_id: Pubkey, pub proposer: Pubkey }
#[event] pub struct ShariaReviewFinalized { pub proposal_id: Pubkey, pub reviewer: Pubkey, pub approved: bool }

#[error_code]
pub enum ZktCoreError { #[msg("Deadline exceeded")] DeadlineExceeded }
