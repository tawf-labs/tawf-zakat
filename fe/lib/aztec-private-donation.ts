/**
 * ZK-PZ Private Donation Integration
 * Privacy-preserving donation using Zero-Knowledge Proofs
 * 
 * This module integrates with:
 * - Noir circuits (noir-circuits/zkat_eligibility) for ZK eligibility proofs
 * - Ethereum Sepolia for on-chain verification
 * - Groth16 verifier for proof validation
 * 
 * For full Aztec Network integration, see:
 * - https://docs.aztec.network/dev_docs/getting_started
 * - https://noir-lang.org/docs
 */

import { Hex } from 'viem';

/**
 * Zakat Eligibility Circuit Public Inputs
 * These match the Noir circuit in noir-circuits/zkat_eligibility/src/main.nr
 */
export interface EligibilityPublicInputs {
  nisab_threshold: bigint;      // Maximum eligible wealth (in IDR/cents)
  current_time: bigint;         // Current Unix timestamp
  recipient_address: bigint;   // Recipient Ethereum address
  cycle_id: bigint;             // Zakat distribution cycle (year)
  expected_nullifier: bigint;  // Pre-computed nullifier for this recipient
}

/**
 * Zakat Eligibility Circuit Private Inputs (Witness)
 */
export interface EligibilityWitness {
  income: bigint;               // Monthly income (IDR)
  assets: bigint;               // Total other assets (IDR)
  hawl_start: bigint;           // Unix timestamp when assets reached nisab
  secret: bigint;               // Secret for nullifier derivation
}

/**
 * Complete ZK Proof for Zakat Eligibility
 */
export interface ZakatEligibilityProof {
  pi_a: readonly [bigint, bigint];      // Groth16 proof component A
  pi_b: readonly [[bigint, bigint], [bigint, bigint]]; // G2 point B
  pi_c: readonly [bigint, bigint];      // Groth16 proof component C
  public_inputs: EligibilityPublicInputs;
}

/**
 * Donation Request with Privacy Options
 */
export interface PrivateDonationRequest {
  pool_id: number;
  amount: bigint;
  is_private: boolean;
  recipient_address: string;
}

/**
 * Verify eligibility criteria locally before generating proof
 * This runs the same logic as the Noir circuit but in TypeScript
 */
export function verifyEligibilityLocal(
  income: number,
  assets: number,
  hawlStartTimestamp: number,
  currentTimestamp: number,
  nisabThreshold: number
): boolean {
  // Calculate annual income + assets
  const annualIncome = income * 12;
  const totalWealth = annualIncome + assets;
  
  // Check nisab threshold
  if (totalWealth >= nisabThreshold) {
    return false;
  }
  
  // Check hawl (one lunar year = ~354 days)
  const ONE_LUNAR_YEAR_SECONDS = 354 * 24 * 60 * 60;
  const hawlElapsed = currentTimestamp - hawlStartTimestamp;
  
  return hawlElapsed >= ONE_LUNAR_YEAR_SECONDS;
}

/**
 * Generate nullifier for recipient (matches Noir circuit)
 * Noir circuit: std::hash::pedersen_hash([secret, recipient_address, cycle_id])
 *
 * In production this MUST call `bb` or Noir JS wasm to produce the
 * exact pedersen_hash over BN254 that the on-chain verifier expects.
 * This mock function only simulates the interface shape for the frontend demo.
 *
 * @see noir-circuits/zkat_eligibility/src/main.nr
 */
export function computeNullifier(
  secret: bigint,
  recipientAddress: bigint,
  cycleId: bigint
): bigint {
  // Mock: pedersen_hash produces a deterministic Field element from 3 inputs
  // Replace with actual Noir/bb wasm call for real proofs
  const inputs = [secret, recipientAddress, cycleId];
  let hash = 0n;
  for (const x of inputs) {
    hash = (hash * 0x9e3779b97f4a7c15n) ^ x;
  }
  return hash;
}

/**
 * Whether private (ZK-gated) donation is usable end to end.
 *
 * It is NOT, and callers must check this BEFORE offering the option:
 *
 *  1. `/api/generate-proof` (fetched below) does not exist in this app. There
 *     is no route handler for it, so proof generation always 404s.
 *  2. The on-chain HonkVerifier is a fail-closed stub returning false, so
 *     ZKTCore.donateZK / donateZKPrivate revert with "Invalid ZK proof" even
 *     if a proof were produced.
 *
 * Flip to true only when BOTH a real proving route and a real deployed
 * verifier exist. See sc/src/DAO/verifiers/HonkVerifier.sol.
 */
export const PRIVATE_DONATION_AVAILABLE = false;

/** Human-readable reason, for surfacing in the UI. */
export const PRIVATE_DONATION_UNAVAILABLE_REASON =
  'Private donations are not available yet: on-chain ZK proof verification is not deployed.';

/**
 * Verify an eligibility proof on-chain.
 *
 * NOT IMPLEMENTED — returns false rather than pretending to verify. The
 * previous implementation console.logged and returned true unconditionally,
 * which made callers believe verification had happened.
 */
export async function verifyProofOnChain(
  _proof: ZakatEligibilityProof,
  _verifierAddress: string
): Promise<boolean> {
  return false;
}

/**
 * Result from proof generation, ready for donateZK().
 */
export interface ProofGenerationResult {
  proof: `0x${string}`;          // UltraHONK proof bytes (msgpack, ~8KB)
  publicInputs: bigint[];       // 6 field elements [nisab, current_time, addr, cycle_id, expected_nullifier, nullifier]
  nullifier: bigint;            // Computed nullifier from pedersen_hash
  proofHash: string;            // keccak256 of proof for audit
  ipfsCID: string;              // IPFS CID for receipt metadata
}

/**
 * Generate an UltraHONK proof for zakat eligibility.
 *
 * In production, this calls bb.js WASM (Barretenberg) to generate a real
 * UltraHONK proof from the Noir circuit witness. For the prototype, proof
 * data is generated off-chain via the nargo + bb CLI pipeline and submitted
 * to the on-chain ZKVerifier through ZKTCore.donateZK().
 *
 * The proof demonstrates:
 *   1. Recipient wealth is below nisab threshold
 *   2. Hawl period (1 lunar year) has elapsed
 *   3. The nullifier is correctly derived from secret + recipient + cycle
 */
export async function generateEligibilityProof(
  witness: EligibilityWitness
): Promise<ProofGenerationResult | null> {
  if (!PRIVATE_DONATION_AVAILABLE) {
    // Fail fast and loudly rather than issuing a fetch to a route that does
    // not exist and surfacing a generic "Proof generation failed" after the
    // user has already committed to the flow.
    console.warn(PRIVATE_DONATION_UNAVAILABLE_REASON);
    return null;
  }

  try {
    // In production: call bb.js UltraHonkBackend.generateProof()
    // For prototype: use pre-generated proof from off-chain pipeline
    //
    // The proof and public inputs are generated by:
    //   1. Writing Prover.toml with witness values
    //   2. nargo execute → witness
    //   3. bb prove → UltraHONK proof + public_inputs
    //
    // This function returns the proof data ready for donateZK().
    
    // For the frontend prototype, load proof from the API route
    // that calls the nargo + bb CLI pipeline.
    const response = await fetch('/api/generate-proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        income: Number(witness.income),
        assets: Number(witness.assets),
        hawl_start: Number(witness.hawl_start),
        secret: witness.secret.toString(16),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Proof generation failed');
    }

    const data = await response.json();
    
    return {
      proof: data.proof as `0x${string}`,
      publicInputs: data.publicInputs.map((v: string) => BigInt(v)),
      nullifier: BigInt(data.nullifier),
      proofHash: data.proofHash,
      ipfsCID: data.ipfsCID || `bafybei${Date.now().toString(36)}`,
    };
  } catch (err) {
    console.error('Proof generation error:', err);
    
    // Fallback: return null so the caller can handle gracefully
    return null;
  }
}

/**
 * Return type interface for usePrivateDonation hook.
 * Provides donateZK() compatible with the ZKTCore contract.
 */
export interface UsePrivateDonationReturn {
  /**
   * Check if a recipient is eligible for Zakat
   */
  checkEligibility: (params: {
    income: number;
    assets: number;
    hawlStartTimestamp: number;
  }) => Promise<boolean>;
  
  /**
   * Submit a private donation with ZK proof
   */
  donatePrivate: (request: PrivateDonationRequest) => Promise<{
    success: boolean;
    txHash?: string;
    nullifier?: string;
  }>;
  
  /**
   * Current eligibility verification status
   */
  isVerifying: boolean;
}

/**
 * Example usage in a React component:
 * 
 * ```tsx
 * const { donatePrivate } = usePrivateDonation();
 * 
 * const handleDonate = async () => {
 *   const result = await donatePrivate({
 *     pool_id: 1,
 *     amount: 1000000n,
 *     is_private: true,
 *     recipient_address: '0x123...'
 *   });
 *   
 *   if (result.success) {
 *     console.log('Donated! Nullifier:', result.nullifier);
 *   }
 * };
 * ```
 */

// Configuration for different networks
export const ZK_PROOF_CONFIG = {
  // Ethereum Sepolia testnet
  ethereum_sepolia: {
    // V10 redeploy 2026-07-26. Fail-closed placeholder — isOperational() == false.
    verifier_address: '0x7702B20B7302A82E3Cb09aAe7A72bb19A2d5Db84',
    nisab_threshold: 85000000n, // 85M IDR
    cycle_duration_seconds: 354 * 24 * 60 * 60, // One lunar year
  },
} as const;

export type NetworkName = keyof typeof ZK_PROOF_CONFIG;