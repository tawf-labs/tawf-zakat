// SPDX-License-Identifier: Apache-2.0
pragma circom 2.0.0;

/**
 * @title VoteCounter
 * @notice Counts the number of approve (1) votes and rejects invalid votes
 * @dev Enforces that all inputs are binary (0 or 1)
 *
 * @param n Number of voters
 *
 * Inputs:
 * - votes[n]: Array of votes (0 or 1)
 *
 * Output:
 * - totalVotes: Sum of all votes (count of 1s)
 */
template VoteCounter(n) {
    signal input votes[n];
    signal output totalVotes;

    // Ensure all votes are binary (0 or 1)
    for (var i = 0; i < n; i++) {
        votes[i] * (votes[i] - 1) === 0;
    }

    // Sum all votes using a linear combination
    // totalVotes = votes[0] + votes[1] + ... + votes[n-1]
    signal sum[n + 1];
    sum[0] <== 0;

    for (var i = 0; i < n; i++) {
        sum[i + 1] <== sum[i] + votes[i];
    }

    totalVotes <== sum[n];
}
