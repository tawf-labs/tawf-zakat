/**
 * Chain adapter for DistributionCertificateNFT (#111), mirroring `registry-chain.ts`'s shape.
 *
 * Mandate truth is never re-read here: `authority()` delegates to an already-configured
 * `RegistryChain` pointed at the deployed ReportEvidenceRegistry (the contract's own
 * `mandateSource`), so this file never re-implements or forks that read.
 */
import {
  createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, decodeEventLog,
  keccak256, toHex, TransactionReceiptNotFoundError, BlockNotFoundError, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { certificateNftAbi as abi } from "../../shared/certificate-nft-abi";
import { contractCertification, contractRecovery, type CertificateDomain, type CertificateIssuanceIntent, type CertificateMintObservation, type CustodyRecoveryIntent } from "../../shared/certificate-nft";
import type { RegistryChain } from "./registry-chain";
import type { CertificateAttempt } from "./certificate-store";

import { certificateBudget, CertificateBudgetError, type CertificateBudgetConfig } from "./certificate-budget";

export type CertificateChainConfig = { rpcUrl: string; chainId: number; address: Hex; privateKey: Hex; requiredConfirmations: number; budget: CertificateBudgetConfig };

export function createCertificateChain(config: CertificateChainConfig, mandateChain: RegistryChain) {
  if (!Number.isSafeInteger(config.chainId) || config.chainId < 1 || !Number.isSafeInteger(config.requiredConfirmations) || config.requiredConfirmations < 1) {
    throw new Error("Konfigurasi kontrak sertifikat tidak sah.");
  }
  const chain = defineChain({ id: config.chainId, name: "Distribution certificate", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
  const account = privateKeyToAccount(config.privateKey);
  const budget = certificateBudget(config.budget, config.chainId, account.address);
  const gas = BigInt(config.budget.gasLimit);
  const maxFeePerGas = BigInt(config.budget.maxFeePerGas);
  const rpc = createPublicClient({ chain, transport: http(config.rpcUrl, { retryCount: 0 }) });
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  const domain: CertificateDomain = { name: "Tawf Distribution Certificate", version: "1", chainId: config.chainId, verifyingContract: config.address };
  const confirmationPolicy = `block-depth-v1:${config.chainId}:${config.requiredConfirmations}`;
  const base = { confirmationPolicy, requiredConfirmations: config.requiredConfirmations, confirmations: 0 };

  // The deployment's chain id and EIP-712 domain never change while this process runs, but every
  // chain method used to re-verify them on its own: reading one certificate line (a handful of
  // methods, each preceded by this check) cost dozens of redundant RPC round trips against a
  // public endpoint - the whole reason a donor's /trace request could take tens of seconds. One
  // verification is memoized here and shared; a failed attempt is not cached, so a transient RPC
  // error does not wrongly and permanently mark the deployment as mismatched.
  let deploymentAsserted: Promise<void> | null = null;
  async function assertDeployment() {
    if (!deploymentAsserted) {
      deploymentAsserted = (async () => {
        if (await rpc.getChainId() !== config.chainId) throw new Error("Chain kontrak sertifikat tidak cocok.");
        const [, name, version, chainId, address] = await rpc.readContract({ address: config.address, abi, functionName: "eip712Domain" });
        if (name !== domain.name || version !== domain.version || chainId !== BigInt(domain.chainId) || address.toLowerCase() !== domain.verifyingContract.toLowerCase()) {
          throw new Error("Domain kontrak sertifikat tidak cocok.");
        }
      })().catch((error) => {
        deploymentAsserted = null;
        throw error;
      });
    }
    return deploymentAsserted;
  }

  /** Issuance and recovery share one fee/gas policy and the same durable attempt format. */
  async function buildAttempt(data: Hex, signature: Hex, nonce: number): Promise<CertificateAttempt> {
    // Estimate/simulate before signing; never let RPC-selected fees expand the reservation.
    const request = { account, to: config.address, data, nonce, value: 0n, maxFeePerGas, maxPriorityFeePerGas: 0n };
    const estimated = await rpc.estimateGas(request);
    if (estimated > gas) throw new CertificateBudgetError("Batas gas anggaran layanan sertifikat tidak mencukupi.");
    const raw = await wallet.signTransaction({ ...request, chain, type: "eip1559", gas });
    return { raw, hash: keccak256(raw), nonce, signature };
  }

  /** Which log in the receipt proves this transaction did what the intent says, and the token it minted. */
  type LogMatcher = (log: any) => { tokenId: bigint } | null;
  async function observe(intent: CertificateIssuanceIntent, hash: Hex, atBlock?: bigint): Promise<CertificateMintObservation> {
    const c = intent.certification;
    const institutionKey = keccak256(toHex(c.institutionId));
    const certificateKey = keccak256(toHex(c.certificateId));
    return observeTransaction(intent.observation, hash, atBlock, (log) => {
      const event = decodeEventLog({ abi, eventName: "CertificateIssued", topics: log.topics, data: log.data, strict: true });
      return event.args.institutionKey === institutionKey && event.args.certificateKey === certificateKey
        && event.args.version === c.version && event.args.digest === c.digest && event.args.signer.toLowerCase() === c.signer.toLowerCase()
        ? { tokenId: event.args.tokenId } : null;
    });
  }
  async function observeRecovery(intent: CustodyRecoveryIntent, hash: Hex, atBlock?: bigint): Promise<CertificateMintObservation> {
    const r = intent.recovery;
    const institutionKey = keccak256(toHex(r.institutionId));
    const certificateKey = keccak256(toHex(r.certificateId));
    return observeTransaction(intent.observation, hash, atBlock, (log) => {
      const event = decodeEventLog({ abi, eventName: "CustodyRecovered", topics: log.topics, data: log.data, strict: true });
      return event.args.institutionKey === institutionKey && event.args.certificateKey === certificateKey
        && event.args.replacedTokenId === BigInt(r.previousTokenId)
        && event.args.newCustodian.toLowerCase() === r.newCustodian.toLowerCase() && event.args.signer.toLowerCase() === r.signer.toLowerCase()
        && event.args.basisDigest === r.basisDigest ? { tokenId: event.args.newTokenId } : null;
    });
  }
  async function observeTransaction(previous: CertificateMintObservation, hash: Hex, atBlock: bigint | undefined, match: LogMatcher): Promise<CertificateMintObservation> {
    const intent = { observation: previous };
    await assertDeployment();
    let receipt;
    try { receipt = await rpc.getTransactionReceipt({ hash }); }
    catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
      if (intent.observation.blockNumber) {
        try {
          const block = await rpc.getBlock({ blockNumber: BigInt(intent.observation.blockNumber) });
          if (block.hash !== intent.observation.blockHash) return { ...base, state: "NONCANONICAL", blockNumber: intent.observation.blockNumber, blockHash: intent.observation.blockHash };
        } catch (error) {
          if (!(error instanceof BlockNotFoundError)) throw error;
          return { ...base, state: "NONCANONICAL", blockNumber: intent.observation.blockNumber, blockHash: intent.observation.blockHash };
        }
      }
      return { ...base, state: "SUBMITTED" };
    }
    if (atBlock !== undefined && receipt.blockNumber > atBlock) return { ...base, state: "SUBMITTED" };
    const evidence = { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
    const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) return { ...base, ...evidence, state: "NONCANONICAL" };
    const timed = { ...evidence, blockTimestamp: block.timestamp.toString() };
    if (receipt.status !== "success") return { ...base, ...timed, state: "REVERTED" };
    if (receipt.transactionHash !== hash || receipt.to?.toLowerCase() !== config.address.toLowerCase()) return { ...base, ...timed, state: "INVALID_EVENT" };
    const uniqueLogs = [...new Map(receipt.logs.map((log) => [JSON.stringify(log, (_, v) => typeof v === "bigint" ? v.toString() : v), log])).values()];
    let tokenId: bigint | undefined;
    const matches = uniqueLogs.filter((log) => {
      if (log.removed || log.address.toLowerCase() !== config.address.toLowerCase() || log.transactionHash !== hash || log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber) return false;
      try {
        const found = match(log);
        if (found) tokenId = found.tokenId;
        return !!found;
      } catch { return false; }
    });
    if (matches.length !== 1 || matches[0]!.logIndex === null) return { ...base, ...timed, state: "INVALID_EVENT" };
    const head = atBlock ?? await rpc.getBlockNumber({ cacheTime: 0 });
    if (head < receipt.blockNumber) return { ...base, ...timed, state: "NONCANONICAL" };
    if ((await rpc.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) return { ...base, ...timed, state: "NONCANONICAL" };
    const confirmations = Number(head - receipt.blockNumber + 1n);
    return { ...base, ...timed, confirmations, logIndex: matches[0]!.logIndex!, tokenId: tokenId?.toString(), state: confirmations >= config.requiredConfirmations ? "CONFIRMED" : "INCLUDED" };
  }

  return {
    readOnly: false,
    domain,
    budget,
    requiredConfirmations: config.requiredConfirmations,
    confirmationPolicy,
    deployment: `${config.chainId}:${config.address.toLowerCase()}:${account.address.toLowerCase()}`,
    /** Delegates to the report registry's own mandate read; never a second source of truth. */
    authority: (institutionId: string, signer: Hex) => mandateChain.authority(institutionId, signer),
    async validate(intent: CertificateIssuanceIntent, signature: Hex) {
      await assertDeployment();
      await rpc.readContract({ address: config.address, abi, functionName: "validateCertification", args: [contractCertification(intent.certification), signature] });
    },
    pendingNonce: () => rpc.getTransactionCount({ address: account.address, blockTag: "pending" }),
    async build(intent: CertificateIssuanceIntent, signature: Hex, nonce: number): Promise<CertificateAttempt> {
      const data = encodeFunctionData({ abi, functionName: "issueCertificate", args: [contractCertification(intent.certification), signature] });
      return buildAttempt(data, signature, nonce);
    },
    async broadcast(attempt: CertificateAttempt) {
      const hash = await rpc.sendRawTransaction({ serializedTransaction: attempt.raw });
      if (hash !== attempt.hash) throw new Error("Identitas transaksi berubah.");
    },
    async tokenOf(institutionId: string, certificateId: string, version: string) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "certificateVersionToken", args: [institutionId, certificateId, version] });
    },
    async publicView(tokenId: bigint) {
      await assertDeployment();
      const [issuer, contentDigest, custodian, successorTokenId, predecessorTokenId, originalTokenId] = await Promise.all([
        rpc.readContract({ address: config.address, abi, functionName: "issuerOf", args: [tokenId] }),
        rpc.readContract({ address: config.address, abi, functionName: "contentDigestOf", args: [tokenId] }),
        rpc.readContract({ address: config.address, abi, functionName: "ownerOf", args: [tokenId] }),
        rpc.readContract({ address: config.address, abi, functionName: "successorOf", args: [tokenId] }),
        rpc.readContract({ address: config.address, abi, functionName: "predecessorOf", args: [tokenId] }),
        rpc.readContract({ address: config.address, abi, functionName: "originalTokenOf", args: [tokenId] }),
      ]);
      return { issuer, contentDigest, custodian, successorTokenId, predecessorTokenId, originalTokenId };
    },
    /** The line's official head as the chain sees it now. Empty until the first version mints. */
    async latestVersion(institutionId: string, certificateId: string) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "latestCertificateVersion", args: [institutionId, certificateId] });
    },
    async certificateOf(tokenId: bigint) {
      await assertDeployment();
      const [activityId, certificateId, version] = await rpc.readContract({ address: config.address, abi, functionName: "certificateOf", args: [tokenId] });
      return { activityId, certificateId, version };
    },
    observe,
    observeRecovery,
    async validateRecovery(intent: CustodyRecoveryIntent, signature: Hex) {
      await assertDeployment();
      await rpc.readContract({ address: config.address, abi, functionName: "validateRecovery", args: [contractRecovery(intent.recovery), signature] });
    },
    async buildRecovery(intent: CustodyRecoveryIntent, signature: Hex, nonce: number): Promise<CertificateAttempt> {
      const data = encodeFunctionData({ abi, functionName: "recoverCustody", args: [contractRecovery(intent.recovery), signature] });
      return buildAttempt(data, signature, nonce);
    },
    /** Both custody and registry administrator epochs are read through the NFT's mandate source. */
    async recoveryEpochs(institutionId: string) {
      await assertDeployment();
      const [custodyEpoch, administratorEpoch] = await rpc.readContract({
        address: config.address, abi, functionName: "recoveryEpochs", args: [keccak256(toHex(institutionId))],
      });
      return { custodyEpoch, administratorEpoch };
    },
    /** The custodian new tokens would go to right now: the designated one, else the registry administrator. */
    async resolvedCustodian(institutionId: string) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "resolvedCustodian", args: [keccak256(toHex(institutionId))] });
    },
    /** Holders of every token that has represented this version, oldest first, and which one is active. */
    async custodyTokens(activeTokenId: bigint) {
      await assertDeployment();
      const chainOfTokens: bigint[] = [activeTokenId];
      for (;;) {
        const before = await rpc.readContract({ address: config.address, abi, functionName: "custodyReplacementOf", args: [chainOfTokens[0]!] });
        if (before === 0n) break;
        chainOfTokens.unshift(before);
      }
      return Promise.all(chainOfTokens.map(async (tokenId) => ({
        tokenId, status: tokenId === activeTokenId ? "ACTIVE" as const : "REPLACED" as const,
        holder: await rpc.readContract({ address: config.address, abi, functionName: "ownerOf", args: [tokenId] }),
      })));
    },
  };
}
export type CertificateChain = ReturnType<typeof createCertificateChain>;
