pragma circom 2.1.6;

// Zakat eligibility proof (Solana port — ADR-0002, ADR-0004).
//
// Proves, without revealing the donor's wealth, that a donation QUALIFIES AS
// ZAKAT: the donor is above the nisab threshold and has held that wealth for at
// least one hawl (lunar year). Emits a Poseidon nullifier so the same
// (donor-secret, campaign, cycle) can donate-as-zakat only once.
//
// Predicate is `wealth >= nisab` (muzakki / obligatory zakat) — the inherited
// Ethereum Noir circuit had this inverted; see ADR-0004 Decision 1.
//
// Hash = Poseidon (not Pedersen): native Solana syscall + circuit/on-chain
// parity, verified on-chain via Light Protocol's groth16-solana.

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// One Islamic lunar year in seconds (354 days). Hijri year ≈ 354.37 days;
// we floor to 354 days so the hawl test never passes early.
function ONE_LUNAR_YEAR() {
    return 354 * 24 * 60 * 60; // 30_585_600
}

template ZakatEligibility() {
    // --- private witness ---
    signal input income;     // monthly income, IDR base units
    signal input assets;     // other assets, IDR base units
    signal input hawlStart;  // unix ts when wealth first reached nisab
    signal input secret;     // donor secret, drives the nullifier

    // --- public inputs ---
    signal input nisab;       // nisab threshold (IDR base units)
    signal input currentTime; // unix ts (bind to a recent on-chain clock)
    signal input campaignId;  // donation target (pool), NOT "recipient"
    signal input cycleId;     // zakat cycle / year

    // --- public output ---
    signal output nullifier;

    // total annual wealth = income*12 + assets   (>= nisab)
    signal annualIncome;
    annualIncome <== income * 12;
    signal totalWealth;
    totalWealth <== annualIncome + assets;

    // 64-bit range covers IDR amounts and unix timestamps comfortably.
    component nisabOk = GreaterEqThan(64);
    nisabOk.in[0] <== totalWealth;
    nisabOk.in[1] <== nisab;
    nisabOk.out === 1;

    // hawl: currentTime >= hawlStart + ONE_LUNAR_YEAR
    component hawlOk = GreaterEqThan(64);
    hawlOk.in[0] <== currentTime;
    hawlOk.in[1] <== hawlStart + ONE_LUNAR_YEAR();
    hawlOk.out === 1;

    // nullifier = Poseidon(secret, campaignId, cycleId)
    component h = Poseidon(3);
    h.inputs[0] <== secret;
    h.inputs[1] <== campaignId;
    h.inputs[2] <== cycleId;
    nullifier <== h.out;
}

// Public signals (order matters for the on-chain verifier). snarkjs emits
// circuit OUTPUTS first, then public inputs in declaration order:
//   [nullifier, nisab, currentTime, campaignId, cycleId]
component main {public [nisab, currentTime, campaignId, cycleId]} = ZakatEligibility();
