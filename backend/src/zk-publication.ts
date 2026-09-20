import { encodeFunctionData, keccak256, parseTransaction, parseAbi, parseAbiItem, type Hex } from "viem";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceRuntime } from "./workspace-runtime";
import type { Publication, SignedPublicationAttempt } from "./zk-publication-store";
import { operationalActor, OperationalAccessDenied } from "./operational-access";
import { CONTRIBUTION_PROOF_REGISTRY_ABI } from "./zk-proof-service";
import { receiptIsFinal } from "./zk-finality";

const receiptEvent = parseAbiItem("event ReceiptProofVerified(bytes32 indexed receiptKey, string institutionId, string contributionId, uint256 batchId, uint256 version, bytes32 batchRoot, bytes32 receiptCommitment, address submitter)");
const authorityAbi = parseAbi([
  "function batches(bytes32,uint256) view returns (bytes32 root,uint256 version,address endorsedBy,uint256 endorsedAt,bool exists)",
  "function authorizedSigners(bytes32,address) view returns (bool)",
  "function admissionAuthority() view returns (address)",
]);
export function publicationView(op: Publication) {
  return { id: op.id, contributionId: op.contributionId, version: op.version, status: op.status,
    attempts: op.attempts, txHash: op.txHash, blockNumber: op.blockNumber, error: op.error };
}
export function publicationArtifactId() {
  return createHash("sha256").update(readFileSync(join(__dirname, "../../sc/circuits/artifacts.sha256"))).digest("hex");
}
class PublicationBlocked extends Error {}

/** One bounded operation per tick. SQL owns the lease and all broadcast material. */
export async function runZkPublication(runtime: WorkspaceRuntime, targetId?: string): Promise<void> {
  const { zkPublications: store, zkBudget: budget, zkBatches: batches, zkProver: prover,
    zkWalletClient: wallet, zkPublicClient: client, zkRegistryAddress: registry } = runtime;
  if (!store || !budget || !batches || !prover || !wallet || !client || !registry) return;
  const token = await store.acquire(budget.id, runtime.now());
  if (!token) return;
  let op: Publication | undefined;
  let retired: SignedPublicationAttempt | undefined;
  const save = () => retired
    ? store.saveRecoveredAttempt(retired, op!, budget.id, token, runtime.now())
    : store.save(op!, budget.id, token, runtime.now());
  try {
    const all = await store.list();
    // Reconcile final receipts, including reverted transactions, before selecting work.
    for (const previous of all.filter(p => ["CONFIRMED", "REVERTED"].includes(p.status))) {
      if (!await publicationHasFinalReceipt(runtime, previous)) {
        previous.status = "UNCONFIRMED";
        previous.error = "Konfirmasi chain belum tersedia; periksa ulang.";
        await store.save(previous, budget.id, token, runtime.now());
      }
    }
    for (const previous of all.filter(p => p.status === "CONFIRMED" && !p.notified)) {
      if (!runtime.zkNotifications) break;
      try {
        await runtime.zkNotifications.send({ operationId: previous.id, status: previous.status });
        previous.notified = true; await store.save(previous, budget.id, token, runtime.now());
      } catch { /* Retry notification next tick; confirmation remains independent. */ }
    }
    // Never allocate a second nonce while any signed transaction is unresolved.
    op = all.filter(p => p.rawTransaction && !["CONFIRMED", "REVERTED"].includes(p.status))
      .sort((a, b) => Number(parseTransaction(a.rawTransaction!).nonce) - Number(parseTransaction(b.rawTransaction!).nonce))[0] ??
      all.find(p => (!targetId || p.id === targetId || (p.contributionId && targetId === `receipt:${p.contributionId}:${p.version}`)) && ["QUEUED", "PROVING", "SUBMITTING", "PENDING"].includes(p.status)
        && (!p.contributionId || all.some(r => r.batchId === p.batchId && !r.contributionId && r.status === "CONFIRMED")));
    // A reorg can remove the failed transaction that consumed a retry's previous
    // nonce. Replay its original, already-budgeted bytes before the newer attempt.
    // Keep the current operation intact: history is not a replacement attempt.
    const chainNonce = await client.getTransactionCount({ address: wallet.account.address, blockTag: "latest" });
    retired = (await store.retiredTransactions())
      .filter(a => Number(parseTransaction(a.rawTransaction).nonce) >= chainNonce || a.status === "PENDING")
      .sort((a, b) => Number(parseTransaction(a.rawTransaction).nonce) - Number(parseTransaction(b.rawTransaction).nonce))[0];
    if (retired && (!op?.rawTransaction ||
        Number(parseTransaction(retired.rawTransaction).nonce) < Number(parseTransaction(op.rawTransaction).nonce))) {
      const current = all.find(p => p.id === retired!.operationId)!;
      op = { ...current, rawTransaction: retired.rawTransaction, txHash: retired.txHash,
        artifactId: retired.artifactId, status: "PENDING", blockHash: null, blockNumber: null };
    } else { retired = undefined; }
    if (!op) return;
    const batch = await batches.getBatch(op.institutionId, op.batchId);
    if (!batch || !batch.endorsedBy) throw new PublicationBlocked("Pengesahan batch belum tersedia.");
    let receipt: any;
    if (op.txHash) {
      try { receipt = await client.getTransactionReceipt({ hash: op.txHash }); } catch { /* No canonical result yet. */ }
    }
    const assertAuthority = async (reconcileOnly = false) => {
      if (!reconcileOnly) {
        if (!await batches.batchIsCurrent(op!.institutionId, op!.batchId)) throw new PublicationBlocked("Snapshot berubah; perlu batch yang sesuai.");
        const membership = await runtime.store.activeMembershipFor(batch.endorsedBy!);
        if (!membership || membership.institutionId !== op!.institutionId || membership.role === "READER") throw new PublicationBlocked("Keanggotaan pengesah tidak aktif.");
        const actor = await operationalActor(runtime, { account: batch.endorsedBy!, institutionId: op!.institutionId });
        const mandate = actor.require("ENDORSE_CONTRIBUTIONS", { nominalAmount: batch.currencyUnit === "IDR" ? BigInt(batch.totalAmountExact) : undefined });
        if (mandate.id !== batch.endorsementMandateId || mandate.version !== batch.endorsementMandateVersion) throw new PublicationBlocked("Mandat pengesahan berubah.");
        const key = keccak256(Buffer.from(op!.institutionId));
        const allowed = await client.readContract({ address: registry, abi: authorityAbi, functionName: "authorizedSigners", args: [key, wallet.account.address] });
        const admission = await client.readContract({ address: registry, abi: authorityAbi, functionName: "admissionAuthority" });
        if (!allowed && admission.toLowerCase() !== wallet.account.address.toLowerCase()) throw new PublicationBlocked("Layanan tidak berwenang pada registry.");
      }
      prover.assertArtifacts();
      await prover.assertDeployment(client, registry);
      const id = `${await client.getChainId()}:${registry.toLowerCase()}:${wallet.account.address.toLowerCase()}:${publicationArtifactId()}`;
      if (op!.artifactId && op!.artifactId !== id) throw new PublicationBlocked("Artefak atau tujuan transaksi berubah.");
      op!.artifactId = id;
      if (!await store.owns(budget.id, token, runtime.now())) throw new Error("LEASE_LOST");
    };
    await assertAuthority(!!receipt);
    if (receipt?.status === "reverted") {
      if (!await receiptIsFinal(runtime, receipt)) { op.status = "PENDING"; await save(); return; }
      op.status = "REVERTED"; op.error = "Transaksi revert; penerimaan tetap tercatat.";
      op.blockHash = receipt.blockHash; op.blockNumber = Number(receipt.blockNumber); await save(); return;
    }
    const root = await client.readContract({ address: registry, abi: authorityAbi, functionName: "batches",
      args: [keccak256(Buffer.from(op.institutionId)), BigInt(batch.batchNumber)] });
    if (!op.contributionId) {
      if (root[4]) {
        if (root[1] === BigInt(batch.version)) {
          if (root[0] !== batch.merkleRoot) throw new PublicationBlocked("Root registry tidak cocok.");
        } else if (root[1] > BigInt(batch.version)) {
          throw new PublicationBlocked("Root registry sudah berada di versi lebih baru.");
        } else if (root[1] !== BigInt(batch.version - 1)) {
          throw new PublicationBlocked("Versi registry tidak berurutan.");
        }
      } else if (batch.version !== 1) {
        throw new PublicationBlocked("Versi batch awal harus 1.");
      }
    } else {
      if (!root[4]) throw new PublicationBlocked("Root belum terkonfirmasi; kemungkinan reorganisasi chain.");
      const isCurrent = (root[0] === batch.merkleRoot && root[1] === BigInt(batch.version));
      if (!isCurrent) {
        const historical = await client.readContract({
          address: registry,
          abi: CONTRIBUTION_PROOF_REGISTRY_ABI,
          functionName: "batchesByRoot",
          args: [keccak256(Buffer.from(op.institutionId)), batch.merkleRoot as Hex],
        });
        if (!historical[4]) throw new PublicationBlocked("Root batch belum terdaftar pada registry.");
      }
    }

    if (!op.rawTransaction && !receipt) {
      // Adopt canonical results from the #108 tracer or a lost SQL checkpoint without spending again.
      if (!op.contributionId && root[4] && root[0] === batch.merkleRoot && root[1] === BigInt(batch.version)) {
        const logs = await client.getLogs({ address: registry,
          event: parseAbiItem("event BatchRootEndorsed(bytes32 indexed institutionKey, string institutionId, uint256 indexed batchId, uint256 indexed version, bytes32 batchRoot, address endorsedBy)"),
          args: { institutionKey: keccak256(Buffer.from(op.institutionId)), batchId: BigInt(batch.batchNumber), version: BigInt(batch.version) }, fromBlock: 0n, toBlock: "latest" });
        const event = logs.find((log: any) => log.args.batchRoot === batch.merkleRoot);
        if (!event) throw new Error("EVENT_UNAVAILABLE");
        op.txHash = event.transactionHash;
        receipt = await client.getTransactionReceipt({ hash: op.txHash });
      } else if (op.contributionId) {
        const existing = await client.readContract({ address: registry, abi: CONTRIBUTION_PROOF_REGISTRY_ABI, functionName: "getReceiptVerification",
          args: [op.institutionId, op.contributionId, BigInt(op.version)] });
        if (existing[0] && existing[2] === batch.merkleRoot) {
          const item = batch.items.find(i => i.contributionId === op!.contributionId)!;
          if (existing[1] !== BigInt(batch.batchNumber) || existing[3] !== item.receiptCommitment) throw new PublicationBlocked("Versi receipt sudah dicatat untuk snapshot lain.");
          const logs = await client.getLogs({ address: registry, event: receiptEvent, fromBlock: existing[5], toBlock: existing[5] });
          const event = logs.find((log: any) => log.args.institutionId === op!.institutionId && log.args.contributionId === op!.contributionId && log.args.version === BigInt(op!.version) && log.args.batchRoot === batch.merkleRoot);
          if (!event) throw new Error("EVENT_UNAVAILABLE");
          op.txHash = event.transactionHash;
          receipt = await client.getTransactionReceipt({ hash: op.txHash });
        }
      }
    }
    if (!op.rawTransaction && !receipt) {
      // Reserve the worst-case transaction cost AND one proving attempt before work.
      // Reservations are conservative and never refunded after a crash.
      if (!await store.reserve(budget, token, op, runtime.now())) {
        op.status = "BUDGET_EXHAUSTED"; op.error = "Anggaran layanan/pilot habis; kontribusi tidak dipotong."; await save(); return;
      }
      op.status = "PROVING";
      await save();
      let data: Hex;
      if (op.contributionId) {
        const witness = await batches.getBatchItemWitness(op.institutionId, op.batchId, op.contributionId);
        if (!witness || witness.version !== op.version) throw new PublicationBlocked("Snapshot receipt tidak cocok.");
        const proof = op.proof ?? await prover.generateProof(witness);
        const expected = [witness.batchRoot, witness.receiptCommitment, witness.institutionKey, witness.contributionIdHash, String(witness.fundType)];
        if (expected.some((v, i) => BigInt(v) !== BigInt(proof.publicSignals[i]) || BigInt(v) !== BigInt(proof.calldata.input[i]))) throw new PublicationBlocked("Artefak proof tidak cocok dengan snapshot.");
        op.proof = proof;
        await save();
        data = encodeFunctionData({ abi: CONTRIBUTION_PROOF_REGISTRY_ABI, functionName: "verifyAndRecordReceiptProof", args: [
          op.institutionId, BigInt(batch.batchNumber), BigInt(op.version), op.contributionId, BigInt(witness.fundType),
          proof.calldata.a.map(BigInt) as [bigint, bigint],
          proof.calldata.b.map(r => r.map(BigInt)) as [[bigint, bigint], [bigint, bigint]],
          proof.calldata.c.map(BigInt) as [bigint, bigint],
          proof.calldata.input.map(BigInt) as [bigint, bigint, bigint, bigint, bigint],
        ] });
      } else {
        data = encodeFunctionData({ abi: CONTRIBUTION_PROOF_REGISTRY_ABI, functionName: "endorseBatchRoot",
          args: [op.institutionId, BigInt(batch.batchNumber), BigInt(batch.version), batch.merkleRoot as Hex] });
      }
      await assertAuthority();
      // Dedicated service signer; no donor signature, value transfer or contribution debit.
      const request = await wallet.prepareTransactionRequest({ account: wallet.account, to: registry, data, value: 0n,
        gas: BigInt(budget.gasLimit), maxFeePerGas: BigInt(budget.maxFeePerGas), maxPriorityFeePerGas: 0n,
        nonce: await client.getTransactionCount({ address: wallet.account.address, blockTag: "pending" }), type: "eip1559" });
      op.rawTransaction = await wallet.signTransaction(request);
      op.txHash = keccak256(op.rawTransaction!);
      op.status = "SUBMITTING";
      await save(); // write-ahead: a crash after this point only replays these exact bytes
    }
    if (!receipt) {
      await assertAuthority();
      op.status = "PENDING"; op.error = null; await save();
      try { await client.sendRawTransaction({ serializedTransaction: op.rawTransaction }); } catch { /* Ambiguous response; retain hash and bytes. */ }
      try { receipt = await client.waitForTransactionReceipt({ hash: op.txHash, timeout: 1500, pollingInterval: 100 }); } catch { return; }
    }
    if (!await receiptIsFinal(runtime, receipt)) { op.status = "PENDING"; await save(); return; }
    if (receipt.status !== "success") {
      op.blockHash = receipt.blockHash; op.blockNumber = Number(receipt.blockNumber);
      op.status = "REVERTED"; op.error = "Transaksi revert; penerimaan tetap tercatat."; await save(); return;
    }
    if (op.contributionId) {
      const current = await client.readContract({ address: registry, abi: CONTRIBUTION_PROOF_REGISTRY_ABI, functionName: "getReceiptVerification",
        args: [op.institutionId, op.contributionId, BigInt(op.version)] });
      const item = batch.items.find(i => i.contributionId === op!.contributionId)!;
      if (!current[0] || current[1] !== BigInt(batch.batchNumber) || current[2] !== batch.merkleRoot || current[3] !== item.receiptCommitment) throw new PublicationBlocked("Hasil registry tidak cocok.");
      // Use the event that first recorded this receipt, not a replay transaction.
      const logs = await client.getLogs({ address: registry,
        event: receiptEvent,
        fromBlock: current[5], toBlock: current[5] });
      const event = logs.find((l: any) => l.args.institutionId === op!.institutionId && l.args.contributionId === op!.contributionId && l.args.version === BigInt(op!.version) && l.args.batchRoot === batch.merkleRoot);
      if (!event?.transactionHash) throw new Error("EVENT_UNAVAILABLE");
      await batches.saveReceiptProof({ contributionId: op.contributionId, batchId: op.batchId, version: op.version, status: "VERIFIED",
        publicSignals: op.proof?.publicSignals, proof: op.proof?.proof, txHash: event.transactionHash,
        blockNumber: Number(current[5]), verifiedAt: Number(current[4]), now: runtime.now() });
    } else {
      await batches.endorseBatch({ institutionId: op.institutionId, batchId: op.batchId, endorsedBy: batch.endorsedBy,
        endorsementMandateId: batch.endorsementMandateId ?? undefined, txHash: op.txHash!, now: runtime.now() });
    }
    op.status = "CONFIRMED"; op.error = null; op.blockHash = receipt.blockHash; op.blockNumber = Number(receipt.blockNumber);
    await save();
    if (!retired && runtime.zkNotifications && !op.notified) {
      try {
        await runtime.zkNotifications.send({ operationId: op.id, status: op.status });
        op.notified = true; await save();
      } catch { /* Durable notification retries cannot invalidate chain success. */ }
    }
  } catch (error) {
    if (op && await store.owns(budget.id, token, runtime.now())) {
      op.status = error instanceof PublicationBlocked || error instanceof OperationalAccessDenied ? "BLOCKED" : op.rawTransaction ? "PENDING" : "RETRY";
      op.error = error instanceof PublicationBlocked ? error.message : "Pemrosesan belum terkonfirmasi; periksa atau coba lagi.";
      await save();
    }
  } finally { await store.release(budget.id, token); }
}

async function publicationHasFinalReceipt(runtime: WorkspaceRuntime, op: Publication): Promise<boolean> {
  try {
    await runtime.zkProver!.assertDeployment(runtime.zkPublicClient, runtime.zkRegistryAddress!);
    const receipt = await runtime.zkPublicClient.getTransactionReceipt({ hash: op.txHash });
    return receipt.status === (op.status === "REVERTED" ? "reverted" : "success") &&
      receipt.blockHash === op.blockHash && await receiptIsFinal(runtime, receipt);
  } catch { return false; }
}

/** Live, read-only projection: a previously confirmed database row is never enough. */
export async function inspectPublications(runtime: WorkspaceRuntime, institutionId: string, batchId: string) {
  const operations = await runtime.zkPublications!.list(institutionId, batchId);
  for (const op of operations) {
    if (op.status === "CONFIRMED" && !await publicationHasFinalReceipt(runtime, op)) {
      op.status = "UNCONFIRMED"; op.error = "Konfirmasi chain belum tersedia; periksa ulang.";
    }
  }
  return operations.map(publicationView);
}
