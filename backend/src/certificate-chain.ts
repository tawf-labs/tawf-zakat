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
import { contractCertification, type CertificateDomain, type CertificateIssuanceIntent, type CertificateMintObservation } from "../../shared/certificate-nft";
import type { RegistryChain } from "./registry-chain";
import type { CertificateAttempt } from "./certificate-store";

export type CertificateChainConfig = { rpcUrl: string; chainId: number; address: Hex; privateKey: Hex; requiredConfirmations: number };

export function createCertificateChain(config: CertificateChainConfig, mandateChain: RegistryChain) {
  if (!Number.isSafeInteger(config.chainId) || config.chainId < 1 || !Number.isSafeInteger(config.requiredConfirmations) || config.requiredConfirmations < 1) {
    throw new Error("Konfigurasi kontrak sertifikat tidak sah.");
  }
  const chain = defineChain({ id: config.chainId, name: "Distribution certificate", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
  const account = privateKeyToAccount(config.privateKey);
  const rpc = createPublicClient({ chain, transport: http(config.rpcUrl, { retryCount: 0 }) });
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  const domain: CertificateDomain = { name: "Tawf Distribution Certificate", version: "1", chainId: config.chainId, verifyingContract: config.address };
  const confirmationPolicy = `block-depth-v1:${config.chainId}:${config.requiredConfirmations}`;
  const base = { confirmationPolicy, requiredConfirmations: config.requiredConfirmations, confirmations: 0 };

  async function assertDeployment() {
    if (await rpc.getChainId() !== config.chainId) throw new Error("Chain kontrak sertifikat tidak cocok.");
    const [, name, version, chainId, address] = await rpc.readContract({ address: config.address, abi, functionName: "eip712Domain" });
    if (name !== domain.name || version !== domain.version || chainId !== BigInt(domain.chainId) || address.toLowerCase() !== domain.verifyingContract.toLowerCase()) {
      throw new Error("Domain kontrak sertifikat tidak cocok.");
    }
  }

  async function observe(intent: CertificateIssuanceIntent, hash: Hex, atBlock?: bigint): Promise<CertificateMintObservation> {
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
    const c = intent.certification;
    const institutionKey = keccak256(toHex(c.institutionId));
    const certificateKey = keccak256(toHex(c.certificateId));
    const uniqueLogs = [...new Map(receipt.logs.map((log) => [JSON.stringify(log, (_, v) => typeof v === "bigint" ? v.toString() : v), log])).values()];
    let tokenId: bigint | undefined;
    const matches = uniqueLogs.filter((log) => {
      if (log.removed || log.address.toLowerCase() !== config.address.toLowerCase() || log.transactionHash !== hash || log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber) return false;
      try {
        const event = decodeEventLog({ abi, eventName: "CertificateIssued", topics: log.topics, data: log.data, strict: true });
        const found = event.args.institutionKey === institutionKey && event.args.certificateKey === certificateKey
          && event.args.version === c.version && event.args.digest === c.digest && event.args.signer.toLowerCase() === c.signer.toLowerCase();
        if (found) tokenId = event.args.tokenId;
        return found;
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
      const tx = await wallet.prepareTransactionRequest({ to: config.address, data, nonce });
      const raw = await wallet.signTransaction(tx);
      return { raw, hash: keccak256(raw), nonce, signature };
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
      const [issuer, contentDigest, custodian] = await Promise.all([
        rpc.readContract({ address: config.address, abi, functionName: "issuerOf", args: [tokenId] }),
        rpc.readContract({ address: config.address, abi, functionName: "contentDigestOf", args: [tokenId] }),
        rpc.readContract({ address: config.address, abi, functionName: "ownerOf", args: [tokenId] }),
      ]);
      return { issuer, contentDigest, custodian };
    },
    observe,
  };
}
export type CertificateChain = ReturnType<typeof createCertificateChain>;
