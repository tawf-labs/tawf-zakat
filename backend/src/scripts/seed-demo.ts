/**
 * Explicit, append-only seed for the recorded Arbitrum Sepolia demo deployment.
 * bun src/scripts/seed-demo.ts          # read-only plan/preflight
 * bun src/scripts/seed-demo.ts --apply  # transactions + receipt-derived DB records
 * --without-evidence explicitly leaves proposal CIDs empty when uploads are unavailable.
 * No role grants, approval bypass, reset, fake receipts, or production networks.
 */
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData,
  formatEther, getAddress, http, keccak256, parseAbi, zeroHash, type Hex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { CONTRACT_CONFIG } from "../config";
import { GOVERNANCE_ABI, governanceChain } from "../governance-chain";
import { GOVERNANCE_ROLE_HASHES } from "../governance-roles";
import { DEMO_SEED_ID, DEMO_BATCH_ID, DEMO_GAS_BUDGET, DEMO_TOKEN_AMOUNT,
  demoDonations, demoTotalIDR, demoMerkleRoot, demoProposals } from "./seed-demo-plan";

const protocol = getAddress(CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS);
const token = getAddress(CONTRACT_CONFIG.SEPOLIA_USDC_ADDRESS);
const abi = parseAbi([
  "function recordFiatBatchSettlement(uint256,bytes32,uint256)",
  "function fiatBatchRoots(uint256) view returns (bytes32)",
  "function totalCollectedIDR() view returns (uint256)",
  "function totalCollectedUSDC() view returns (uint256)",
  "function proposalCounter() view returns (uint256)",
  "function usdcToken() view returns (address)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function depositUSDC(uint256,bool,bytes32)",
  "function proposeDisbursement(uint8,uint256,uint8,bytes32,string,uint256,address) returns (uint256)",
  "function cancelProposal(uint256,string)",
  "event FiatBatchSettled(uint256 indexed batchId,bytes32 merkleRoot,uint256 totalAmountIDR)",
  "event USDCDeposited(address indexed donor,uint256 amountUSDC,bool isAnonymous,bytes32 commitmentHash)",
]);
const tokenAbi = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);
const key = process.env.PRIVATE_KEY;
if (!key || !process.env.DATABASE_URL) throw new Error("PRIVATE_KEY and DATABASE_URL are required");
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const rpc = createPublicClient({ chain: arbitrumSepolia, transport: http(CONTRACT_CONFIG.RPC_URL, { retryCount: 1, timeout: 20000 }) });
const wallet = createWalletClient({ account, chain: arbitrumSepolia, transport: http(CONTRACT_CONFIG.RPC_URL) });
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
const apply = process.argv.includes("--apply");
const withoutEvidence = process.argv.includes("--without-evidence");
const directory = resolve(import.meta.dir, "../../../.seed-demo");
const journalFile = resolve(directory, `${DEMO_SEED_ID}.json`);
type Journal = { chainId: number; protocol: string; token: string; signer: string;
  cids: Record<string, string>; transactions: Record<string, { hash: Hex; raw: Hex; maxCost: string }> };
let journal: Journal = { chainId: 421614, protocol, token, signer: account.address, cids: {}, transactions: {} };
async function save() {
  await mkdir(directory, { recursive: true });
  await writeFile(`${journalFile}.tmp`, JSON.stringify(journal, null, 2), { mode: 0o600 });
  await rename(`${journalFile}.tmp`, journalFile);
}
async function receipt(name: string, address: Hex, data: Hex) {
  let entry = journal.transactions[name];
  if (!entry) {
    const gas = await rpc.estimateGas({ account, to: address, data });
    const fees = await rpc.estimateFeesPerGas();
    const maxFeePerGas = fees.maxFeePerGas! * 2n;
    const gasLimit = gas * 130n / 100n;
    const maxCost = gasLimit * maxFeePerGas;
    const committed = Object.values(journal.transactions).reduce((s, t) => s + BigInt(t.maxCost), 0n);
    if (committed + maxCost > DEMO_GAS_BUDGET) throw new Error("Demo gas budget exceeded; no transaction sent");
    const request = await wallet.prepareTransactionRequest({ to: address, data, value: 0n, gas: gasLimit,
      maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas!, type: "eip1559" });
    const raw = await wallet.signTransaction(request);
    entry = { hash: keccak256(raw), raw, maxCost: maxCost.toString() };
    journal.transactions[name] = entry;
    await save(); // Persist exact signed bytes BEFORE broadcast: restart never sends a different transaction.
  }
  let confirmed = await rpc.getTransactionReceipt({ hash: entry.hash }).catch(() => null);
  if (!confirmed) {
    await rpc.sendRawTransaction({ serializedTransaction: entry.raw }).catch(() => undefined);
    confirmed = await rpc.waitForTransactionReceipt({ hash: entry.hash, timeout: 120000 });
  }
  if (confirmed.status !== "success") throw new Error(`${name}: transaction reverted`);
  if ((await rpc.getBlock({ blockNumber: confirmed.blockNumber })).hash !== confirmed.blockHash) throw new Error(`${name}: receipt no longer canonical`);
  console.log(`${name}: ${confirmed.transactionHash}`);
  return confirmed;
}
async function pin(key: string, content: unknown) {
  if (journal.cids[key]) return journal.cids[key]!;
  if (!process.env.PINATA_JWT) throw new Error("PINATA_JWT required; fake CIDs are forbidden");
  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PINATA_JWT}` },
    body: JSON.stringify({ pinataContent: content, pinataMetadata: { name: `${DEMO_SEED_ID}-${key}` } }),
  });
  if (!response.ok) throw new Error(`IPFS upload failed (${response.status})`);
  const body = await response.json();
  if (typeof body.IpfsHash !== "string" || !body.IpfsHash) throw new Error("Missing IPFS CID");
  journal.cids[key] = body.IpfsHash;
  await save();
  return body.IpfsHash as string;
}
async function main() {
  try { journal = JSON.parse(await readFile(journalFile, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (journal.chainId !== 421614 || journal.protocol !== protocol || journal.token !== token || journal.signer !== account.address) throw new Error("Journal target mismatch");
  if (protocol.toLowerCase() !== "0x0d6cec28a574aca41b879767b081f6f2b4e9a849" ||
      token.toLowerCase() !== "0x1f439a83354ae624a4e8acbc4e9873eaa2e1f852" ||
      await rpc.getChainId() !== 421614) throw new Error("This seed only supports the recorded testnet deployment");
  const read = (functionName: "totalCollectedIDR" | "totalCollectedUSDC" | "proposalCounter" | "usdcToken") => rpc.readContract({address: protocol, abi, functionName});
  if (getAddress(await read("usdcToken") as string) !== token || await rpc.readContract({address: token, abi: tokenAbi, functionName: "decimals"}) !== 6) throw new Error("Token mismatch");
  for (const role of [zeroHash, GOVERNANCE_ROLE_HASHES.RELAYER_ROLE]) {
    if (!await rpc.readContract({address: protocol, abi, functionName: "hasRole", args: [role, account.address]})) throw new Error("Signer lacks required role");
  }
  const existingRoot = await rpc.readContract({ address: protocol, abi, functionName: "fiatBatchRoots", args: [BigInt(DEMO_BATCH_ID)] });
  if (existingRoot !== zeroHash && existingRoot !== demoMerkleRoot) throw new Error("Demo batch ID already belongs to different data");
  if (!Object.keys(journal.transactions).length && (await read("proposalCounter") !== 0n || await read("totalCollectedIDR") !== 0n || await read("totalCollectedUSDC") !== 0n)) throw new Error("Deployment is no longer empty; review before beginning a new seed");
  const columns = await sql`select column_name from information_schema.columns where table_schema='public' and table_name='donations'`;
  if (!columns.some(c => c.column_name === "amount_usdc_6dp")) throw new Error("Apply the USDC identity migration before seeding");
  const [counts] = await sql`select (select count(*) from donations)::int as donations, (select count(*) from disbursement_proposals)::int as proposals`;
  console.log(JSON.stringify({ mode: apply ? "apply" : "plan", seed: DEMO_SEED_ID, chainId: 421614, protocol, token,
    signer: account.address, balanceETH: formatEther(await rpc.getBalance({address: account.address})),
    donations: demoDonations.length, fiatBatch: DEMO_BATCH_ID, totalIDR: demoTotalIDR,
    mockUSDCToMintAndDeposit: "100", evidence: withoutEvidence ? "NONE (CID deliberately empty)" : "Pinata upload", proposals: demoProposals.map(p => ({ label: p.label, amountIDR: p.amount.toString(), finalStatus: p.cancel ? "Cancelled" : "Pending" })),
    maxGasBudgetTestnetETH: formatEther(DEMO_GAS_BUDGET), databaseBefore: counts }));
  if (!Object.keys(journal.transactions).length && (counts!.donations !== 0 || counts!.proposals !== 0)) throw new Error("Database contains existing business data; review before seeding");
  if (!apply) return;
  const { dbService, db } = await import("../db/index");
  try {
    const batch = await receipt("fiat-batch", protocol, encodeFunctionData({ abi, functionName: "recordFiatBatchSettlement", args: [BigInt(DEMO_BATCH_ID), demoMerkleRoot, BigInt(demoTotalIDR)] }));
    if (await rpc.readContract({ address: protocol, abi, functionName: "fiatBatchRoots", args: [BigInt(DEMO_BATCH_ID)] }) !== demoMerkleRoot) throw new Error("Batch root mismatch");
    await sql.begin(async tx => {
      for (const d of demoDonations) {
        await tx`insert into donations (trx_id,donor_name,is_anonymous,amount_idr,salt,status,payment_method,batch_id,created_at,paid_at)
          values (${d.trxId},${d.donorName},${d.isAnonymous},${d.amountIDR},${d.salt},'BATCHED','QRIS',${DEMO_BATCH_ID},${d.timestamp},${d.timestamp}) on conflict (trx_id) do nothing`;
      }
      await tx`insert into merkle_batches (batch_number,merkle_root,total_amount_idr,item_count,tx_hash,status)
        values (${DEMO_BATCH_ID},${demoMerkleRoot},${demoTotalIDR},${demoDonations.length},${batch.transactionHash},'settled_onchain') on conflict (batch_number) do nothing`;
    });
    await receipt("mint-mock-usdc", token, encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [account.address, DEMO_TOKEN_AMOUNT] }));
    await receipt("approve-mock-usdc", token, encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [protocol, DEMO_TOKEN_AMOUNT] }));
    const deposit = await receipt("deposit-mock-usdc", protocol, encodeFunctionData({ abi, functionName: "depositUSDC", args: [DEMO_TOKEN_AMOUNT, false, keccak256(new TextEncoder().encode(DEMO_SEED_ID))] }));
    for (const log of deposit.logs.filter(l => l.address.toLowerCase() === protocol.toLowerCase())) {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "USDCDeposited") {
        const result = await dbService.recordUSDCDonation({ chainId: 421614, contract: protocol, txHash: deposit.transactionHash,
          logIndex: log.logIndex!, blockNumber: Number(deposit.blockNumber),
          occurredAt: new Date(Number((await rpc.getBlock({blockNumber: deposit.blockNumber})).timestamp) * 1000).toISOString(), ...decoded.args });
        if (!result.success) throw new Error("Could not persist confirmed USDC deposit");
        await sql`update donations set donor_name=${"DEMO sintetis — Donasi MockUSDC"} where deposit_tx_hash=${deposit.transactionHash} and deposit_log_index=${log.logIndex!} and deposit_contract=${protocol.toLowerCase()}`;
      }
    }
    for (const p of demoProposals) {
      const cid = withoutEvidence ? "" : await pin(p.key, { schemaVersion: "1.1.0", docType: "DISBURSEMENT_PROOF", isSynthetic: true,
        seed: DEMO_SEED_ID, beneficiaryName: p.label, beneficiaryNIKMasked: "SINTETIS-TANPA-NIK",
        beneficiaryHash: p.beneficiaryHash, amount: Number(p.amount), currency: "IDR", asnafCategory: p.asnaf === 0 ? "Fakir" : "Miskin",
        description: "Data contoh testnet, bukan penerima atau penyaluran sungguhan.", timestamp: "2026-09-09T00:00:00.000Z" });
      const proposed = await receipt(`propose-${p.key}`, protocol, encodeFunctionData({abi, functionName: "proposeDisbursement",
        args: [p.currencyType, p.amount, p.asnaf, p.beneficiaryHash, cid, p.periodId, p.recipient]}));
      const confirmed = await governanceChain.confirm("propose", proposed.transactionHash);
      const metadata = { beneficiaryName: p.label, beneficiaryNIKMasked: "SINTETIS-TANPA-NIK" };
      const signature = await account.signMessage({message: `Tawf metadata\n421614\n${protocol.toLowerCase()}\n${proposed.transactionHash}\n${JSON.stringify(metadata)}`});
      await dbService.confirmGovernance("propose", proposed.transactionHash, confirmed.proposal.proposalId, metadata, signature);
      if (p.cancel) {
        const cancelled = await receipt(`cancel-${p.key}`, protocol, encodeFunctionData({ abi, functionName: "cancelProposal", args: [BigInt(confirmed.proposal.proposalId), "DEMO sintetis — contoh pembatalan"] }));
        await dbService.confirmGovernance("cancel", cancelled.transactionHash, confirmed.proposal.proposalId);
      }
    }
    // Log only events proven by successful, canonical receipts from this contract.
    for (const entry of Object.values(journal.transactions)) {
      const r = await rpc.getTransactionReceipt({hash: entry.hash});
      for (const log of r.logs.filter(l => l.address.toLowerCase() === protocol.toLowerCase())) {
        const event = decodeEventLog({abi: [...abi, ...GOVERNANCE_ABI], data: log.data, topics: log.topics});
        await dbService.recordOnchainEvent({ txHash: r.transactionHash, blockNumber: Number(r.blockNumber), logIndex: log.logIndex!,
          eventName: event.eventName, contractAddress: protocol, argsJson: JSON.stringify(event.args, (_, v) => typeof v === "bigint" ? v.toString() : v) });
      }
    }
    const [actual] = await sql`select count(*)::int as count, sum(amount_idr)::text as total from donations where batch_id=${DEMO_BATCH_ID}`;
    if (actual!.count !== demoDonations.length || actual!.total !== String(demoTotalIDR)) throw new Error("Final fiat DB verification failed");
    const rows = await sql`select proposal_id_on_chain, status, beneficiary_name from disbursement_proposals order by proposal_id_on_chain`;
    if (rows.length !== demoProposals.length) throw new Error("Final proposal count mismatch");
    console.log(JSON.stringify({verified: true, fiat: actual, proposals: rows, totalCollectedIDR: String(await read("totalCollectedIDR")), totalCollectedUSDC: String(await read("totalCollectedUSDC"))}));
  } finally { await db?.$client.end({timeout: 2}); }
}
try { await main(); }
catch (error) { console.error(`Seed failed: ${error instanceof Error && !/https?:|postgres:|0x[0-9a-f]{64}/i.test(error.message) ? error.message : "provider error (details suppressed)"}`); process.exitCode = 1; }
finally { await sql.end({timeout: 2}); }
