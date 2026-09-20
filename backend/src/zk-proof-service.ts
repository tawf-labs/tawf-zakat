/**
 * ZK Proof Service (Spec #100, Issue #108)
 *
 * Coordinates real Groth16 proof generation and local EVM contract verification.
 * - Enforces privacy: Witness, donor PII, amounts, and Merkle siblings stay private
 *   and are NEVER leaked to logs or public projections (AC15).
 * - Enforces honest status: Fails safely on proving or execution failure without
 *   manufacturing simulated success (AC20).
 * - Runs proving via isolated Node process to protect against Bun worker thread quirks.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAbiItem, type Hex } from "viem";
import type { BatchItemWitness } from "./zk-batch-store";

const execFileAsync = promisify(execFile);

export const CONTRIBUTION_PROOF_REGISTRY_ABI = [
  {
    type: "function",
    name: "endorseBatchRoot",
    inputs: [
      { name: "institutionId", type: "string" },
      { name: "batchId", type: "uint256" },
      { name: "version", type: "uint256" },
      { name: "batchRoot", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "verifyAndRecordReceiptProof",
    inputs: [
      { name: "institutionId", type: "string" },
      { name: "batchId", type: "uint256" },
      { name: "version", type: "uint256" },
      { name: "contributionId", type: "string" },
      { name: "fundType", type: "uint256" },
      { name: "a", type: "uint256[2]" },
      { name: "b", type: "uint256[2][2]" },
      { name: "c", type: "uint256[2]" },
      { name: "publicSignals", type: "uint256[5]" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getReceiptVerification",
    inputs: [
      { name: "institutionId", type: "string" },
      { name: "contributionId", type: "string" },
      { name: "version", type: "uint256" },
    ],
    outputs: [
      { name: "isVerified", type: "bool" },
      { name: "batchId", type: "uint256" },
      { name: "batchRoot", type: "bytes32" },
      { name: "receiptCommitment", type: "bytes32" },
      { name: "verifiedAt", type: "uint256" },
      { name: "blockNumber", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReceiptVerificationWithBatch",
    inputs: [
      { name: "institutionId", type: "string" },
      { name: "contributionId", type: "string" },
      { name: "version", type: "uint256" },
    ],
    outputs: [
      { name: "isVerified", type: "bool" },
      { name: "batchId", type: "uint256" },
      { name: "batchVersion", type: "uint256" },
      { name: "batchRoot", type: "bytes32" },
      { name: "receiptCommitment", type: "bytes32" },
      { name: "verifiedAt", type: "uint256" },
      { name: "blockNumber", type: "uint256" },
      { name: "isLatestRegisteredRoot", type: "bool" },
      { name: "businessValidity", type: "uint8" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isLatestRegisteredBatchRoot",
    inputs: [
      { name: "institutionId", type: "string" },
      { name: "batchId", type: "uint256" },
      { name: "batchRoot", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBatchVersion",
    inputs: [
      { name: "institutionId", type: "string" },
      { name: "batchId", type: "uint256" },
      { name: "version", type: "uint256" },
    ],
    outputs: [
      { name: "root", type: "bytes32" },
      { name: "ver", type: "uint256" },
      { name: "endorsedBy", type: "address" },
      { name: "endorsedAt", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
    stateMutability: "view",
  },
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "InvalidAddress", inputs: [] },
  { type: "error", name: "BatchAlreadyExists", inputs: [] },
  { type: "error", name: "BatchNotFound", inputs: [] },
  { type: "error", name: "InvalidBatchVersion", inputs: [] },
  { type: "error", name: "UnauthorizedBatchRoot", inputs: [] },
  { type: "error", name: "InvalidStatementBinding", inputs: [] },
  { type: "error", name: "InvalidProof", inputs: [] },
] as const;

export interface GeneratedZKProof {
  proof: Record<string, unknown>;
  publicSignals: string[];
  calldata: {
    a: [Hex, Hex];
    b: [[Hex, Hex], [Hex, Hex]];
    c: [Hex, Hex];
    input: [Hex, Hex, Hex, Hex, Hex];
  };
}

export interface ZkProofServiceConfig {
  wasmPath?: string;
  zkeyPath?: string;
  runnerScriptPath?: string;
}

export function createZkProofService(config?: ZkProofServiceConfig) {
  const rootDir = join(__dirname, "../..");
  const wasmPath =
    config?.wasmPath ??
    join(rootDir, "sc/circuits/build/contribution_membership_js/contribution_membership.wasm");
  const zkeyPath =
    config?.zkeyPath ??
    join(rootDir, "sc/circuits/build/circuit_final.zkey");
  const runnerScriptPath =
    config?.runnerScriptPath ??
    join(__dirname, "zk-prover-runner.cjs");

  return {
    assertArtifacts(): void {
      // Refuse mixed proving artifacts before sending any transaction.
      try {
        const manifest = readFileSync(join(rootDir, "sc/circuits/artifacts.sha256"), "utf8");
        for (const [path, suffix] of [[wasmPath, "build/contribution_membership_js/contribution_membership.wasm"], [zkeyPath, "build/circuit_final.zkey"]]) {
          const entry = manifest.split("\n").find(line => line.endsWith(`  ${suffix}`));
          const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
          if (!entry || entry.split(" ")[0] !== digest) throw new Error("mismatch");
        }
      } catch { throw new Error("Gagal menghasilkan proof ZK: artefak tidak cocok atau tidak tersedia."); }

    },
    async assertDeployment(publicClient: any, registryAddress: Hex): Promise<void> {
      const verifierAddress = await publicClient.readContract({
        address: registryAddress,
        abi: [{ type: "function", name: "verifier", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
        functionName: "verifier",
      });
      const artifact = JSON.parse(readFileSync(join(rootDir, "sc/out/Groth16Verifier.sol/Groth16Verifier.json"), "utf8"));
      const actual = await publicClient.getBytecode({ address: verifierAddress });
      if (!actual || actual.toLowerCase() !== artifact.deployedBytecode.object.toLowerCase()) {
        throw new Error("Kode verifier tidak cocok dengan artefak pilot.");
      }
    },
    /**
     * Generate real Groth16 proof using the pinned circuit artifacts.
     */
    async generateProof(witness: BatchItemWitness): Promise<GeneratedZKProof> {
      this.assertArtifacts();

      const circuitInput = {
        batchRoot: witness.batchRoot,
        receiptCommitment: witness.receiptCommitment,
        institutionKey: witness.institutionKey,
        contributionIdHash: witness.contributionIdHash,
        fundType: witness.fundType.toString(),
        amount: witness.amount,
        salt: witness.salt,
        purposeHash: witness.purposeHash,
        pathElements: witness.pathElements,
        pathIndices: witness.pathIndices.map(x => x.toString()),
      };

      const privateDir = mkdtempSync(join(tmpdir(), "zkt-prover-"));
      const inputTempPath = join(privateDir, "input.json");
      const outputTempPath = join(privateDir, "output.json");

      try {
        writeFileSync(inputTempPath, JSON.stringify(circuitInput), { encoding: "utf8", mode: 0o600 });

        // Run isolated Node process for snarkjs fullProve
        await execFileAsync("node", [
          runnerScriptPath,
          inputTempPath,
          wasmPath,
          zkeyPath,
          outputTempPath,
        ], { timeout: 120_000, maxBuffer: 1024 * 1024 });

        const outputRaw = readFileSync(outputTempPath, "utf8");
        const parsed = JSON.parse(outputRaw) as GeneratedZKProof;
        return parsed;
      } catch (err: any) {
        throw new Error("Gagal menghasilkan proof ZK.");
      } finally {
        rmSync(privateDir, { recursive: true, force: true });
      }
    },

    /**
     * Verify and record proof on EVM smart contract.
     */
    async verifyAndRecordOnChain({
      institutionId,
      batchIdNumber,
      version,
      contributionId,
      fundType,
      proof,
      registryAddress,
      walletClient,
      publicClient,
    }: {
      institutionId: string;
      batchIdNumber: number;
      version: number;
      contributionId: string;
      fundType: number;
      proof: GeneratedZKProof;
      registryAddress: Hex;
      walletClient: any;
      publicClient: any;
    }): Promise<{
      success: boolean;
      txHash?: Hex;
      blockNumber?: number;
      verifiedAt?: number;
      failureReason?: string;
    }> {
      try {
        const { a, b, c, input } = proof.calldata;

        const aBigInt: [bigint, bigint] = [BigInt(a[0]), BigInt(a[1])];
        const bBigInt: [[bigint, bigint], [bigint, bigint]] = [
          [BigInt(b[0][0]), BigInt(b[0][1])],
          [BigInt(b[1][0]), BigInt(b[1][1])],
        ];
        const cBigInt: [bigint, bigint] = [BigInt(c[0]), BigInt(c[1])];
        const pubSignalsBigInt: [bigint, bigint, bigint, bigint, bigint] = [
          BigInt(input[0]),
          BigInt(input[1]),
          BigInt(input[2]),
          BigInt(input[3]),
          BigInt(input[4]),
        ];


        // A previous attempt may have confirmed before the API lost its response.
        // Recover its canonical event without spending another transaction.
        const prior = await publicClient.readContract({
          address: registryAddress, abi: CONTRIBUTION_PROOF_REGISTRY_ABI,
          functionName: "getReceiptVerification", args: [institutionId, contributionId, BigInt(version)],
        });
        if (prior[0]) {
          if (prior[1] !== BigInt(batchIdNumber) || BigInt(prior[2]) !== BigInt(input[0]) || BigInt(prior[3]) !== BigInt(input[1])) {
            return { success: false, failureReason: "Versi receipt sudah dicatat untuk statement lain." };
          }
          const logs = await publicClient.getLogs({ address: registryAddress,
            event: parseAbiItem("event ReceiptProofVerified(bytes32 indexed receiptKey, string institutionId, string contributionId, uint256 batchId, uint256 version, bytes32 batchRoot, bytes32 receiptCommitment, address submitter)"),
            fromBlock: prior[5], toBlock: prior[5],
          });
          const event = logs.find((log: any) => log.args.institutionId === institutionId && log.args.contributionId === contributionId && log.args.version === BigInt(version));
          if (!event?.transactionHash) return { success: false, failureReason: "Transaksi asal receipt belum ditemukan." };
          const receipt = await publicClient.waitForTransactionReceipt({ hash: event.transactionHash, confirmations: 1 });
          if (receipt.status !== "success") return { success: false, failureReason: "Transaksi asal receipt belum terkonfirmasi." };
          return { success: true, txHash: event.transactionHash, blockNumber: Number(prior[5]), verifiedAt: Number(prior[4]) };
        }

        // Send transaction
        const hash = await walletClient.writeContract({
          address: registryAddress,
          abi: CONTRIBUTION_PROOF_REGISTRY_ABI,
          functionName: "verifyAndRecordReceiptProof",
          args: [
            institutionId,
            BigInt(batchIdNumber),
            BigInt(version),
            contributionId,
            BigInt(fundType),
            aBigInt,
            bBigInt,
            cBigInt,
            pubSignalsBigInt,
          ],
        });

        // Wait for confirmed receipt (AC04, AC18: confirmed onchain execution)
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
        if (receipt.status !== "success") {
          return {
            success: false,
            txHash: hash,
            failureReason: "Transaksi EVM revert saat verifikasi proof.",
          };
        }

        const recorded = await publicClient.readContract({
          address: registryAddress, abi: CONTRIBUTION_PROOF_REGISTRY_ABI,
          functionName: "getReceiptVerification",
          args: [institutionId, contributionId, BigInt(version)],
        });
        if (!recorded[0] || recorded[1] !== BigInt(batchIdNumber) ||
            BigInt(recorded[2]) !== BigInt(input[0]) || BigInt(recorded[3]) !== BigInt(input[1])) {
          return { success: false, failureReason: "Hasil registry tidak cocok dengan statement receipt." };
        }

        return {
          success: true,
          txHash: hash,
          blockNumber: Number(recorded[5]),
          verifiedAt: Number(recorded[4]),
        };
      } catch (err: any) {

        return {
          success: false,
          failureReason: "Verifikasi EVM gagal atau belum terkonfirmasi.",
        };
      }
    },
  };
}

export type ZkProofService = ReturnType<typeof createZkProofService>;
