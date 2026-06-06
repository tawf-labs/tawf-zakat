use arcis::*;

#[encrypted]
pub mod circuits {
    use arcis::*;

    // ============================================================
    // Circuit 1: Zakat Eligibility Check
    // Proves zakat eligibility without revealing income/assets
    // ============================================================

    pub struct ZakatInput {
        pub income: u64,
        pub assets: u64,
        pub hawl_start: u64,
        pub secret: u64,
        pub amount: u64,
    }

    pub struct EligibilityResult {
        pub eligible: bool,
        pub nullifier_0: u64,
        pub nullifier_1: u64,
        pub amount_commitment_0: u64,
        pub amount_commitment_1: u64,
    }

    #[instruction]
    pub fn check_zkat_eligibility(
        input_ctxt: Enc<Shared, ZakatInput>,
        nisab_threshold: u64,
        current_time: u64,
        recipient_0: u64,
        recipient_1: u64,
        cycle_id: u64,
    ) -> Enc<Shared, EligibilityResult> {
        let input = input_ctxt.to_arcis();

        // Confidential checks
        let income_check = input.income < nisab_threshold;
        let hawl_duration: u64 = 365 * 24 * 3600; // 1 year in seconds
        let hawl_check = current_time >= input.hawl_start + hawl_duration;
        let amount_valid = input.amount > 0;

        let eligible = income_check && hawl_check && amount_valid;

        // Compute nullifier (unique per cycle to prevent double-spending)
        let nullifier_0 = compute_nullifier(input.secret, input.amount, recipient_0, cycle_id);
        let nullifier_1 = compute_nullifier(input.amount, input.secret, recipient_1, cycle_id + 1);

        // Compute commitment (hides amount while allowing aggregation)
        let amount_commitment_0 = compute_commitment(input.amount, input.secret);
        let amount_commitment_1 = compute_commitment(input.secret, input.amount);

        input_ctxt.owner.from_arcis(EligibilityResult {
            eligible,
            nullifier_0,
            nullifier_1,
            amount_commitment_0,
            amount_commitment_1,
        })
    }

    // ============================================================
    // Circuit 2: Vote Aggregation
    // Tallies Sharia council votes without revealing individual votes
    // ============================================================

    pub struct ValidatorVote {
        pub approved: bool,
        pub weight: u8,
    }

    pub struct VoteResult {
        pub quorum_met: bool,
        pub total_weight: u8,
        pub approval_count: u8,
        pub proposal_id: u64,
    }

    #[instruction]
    pub fn aggregate_votes(
        votes_ctxt: Enc<Shared, [ValidatorVote; 5]>,
        proposal_id: u64,
        quorum_threshold: u8,
    ) -> Enc<Shared, VoteResult> {
        let votes = votes_ctxt.to_arcis();

        let mut total_weight: u8 = 0;
        let mut approval_count: u8 = 0;

        for vote in votes.iter() {
            if vote.approved {
                total_weight += vote.weight;
                approval_count += 1;
            }
        }

        let quorum_met = total_weight >= quorum_threshold;

        votes_ctxt.owner.from_arcis(VoteResult {
            quorum_met,
            total_weight,
            approval_count,
            proposal_id,
        })
    }

    // ============================================================
    // Circuit 3: Private Donation
    // Processes confidential donations with amount hidden
    // ============================================================

    pub struct DonationInput {
        pub donor_0: u64,
        pub donor_1: u64,
        pub amount: u64,
        pub commitment_0: u64,
        pub commitment_1: u64,
        pub timestamp: u64,
    }

    pub struct DonationReceipt {
        pub receipt_hash_0: u64,
        pub receipt_hash_1: u64,
        pub pool_id: u64,
        pub timestamp: u64,
    }

    #[instruction]
    pub fn process_private_donation(
        input_ctxt: Enc<Shared, DonationInput>,
        pool_id: u64,
    ) -> Enc<Shared, DonationReceipt> {
        let input = input_ctxt.to_arcis();

        // Compute receipt hash (commitment-based, no amount revealed)
        let receipt_hash_0 = compute_commitment(input.donor_0, input.amount);
        let receipt_hash_1 = compute_commitment(input.amount, input.donor_1);

        input_ctxt.owner.from_arcis(DonationReceipt {
            receipt_hash_0,
            receipt_hash_1,
            pool_id,
            timestamp: input.timestamp,
        })
    }

    // ============================================================
    // Helper functions (compiled into MPC circuits)
    // ============================================================

    fn compute_nullifier(a: u64, b: u64, c: u64, d: u64) -> u64 {
        // Simple mixing function for nullifier generation
        let mut result = a.wrapping_mul(31).wrapping_add(b.wrapping_mul(17));
        result = result.wrapping_add(c.wrapping_mul(13));
        result = result.wrapping_add(d.wrapping_mul(7));
        result = result.wrapping_mul(0x9E3779B9); // golden ratio constant
        result
    }

    fn compute_commitment(a: u64, b: u64) -> u64 {
        // Simple Pedersen-like commitment
        let mut result = a.wrapping_mul(31).wrapping_add(b.wrapping_mul(17));
        result = result.wrapping_mul(0x9E3779B9);
        result = result.wrapping_add(a.wrapping_add(b));
        result
    }
}
