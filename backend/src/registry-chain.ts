import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, decodeEventLog, keccak256, toHex, TransactionReceiptNotFoundError, BlockNotFoundError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { reportRegistryAbi as abi } from "../../shared/report-registry-abi";
import { contractAuthorization, type RecordingIntent, type RegistryDomain, type RecordingObservation } from "../../shared/report-registry";
import type { RegistryAttempt } from "./registry-store";

export type RegistryConfig = { rpcUrl: string; chainId: number; address: Hex; privateKey: Hex; requiredConfirmations: number };
export function createRegistryChain(config: RegistryConfig) {
  if (!Number.isSafeInteger(config.chainId) || config.chainId < 1 || !Number.isSafeInteger(config.requiredConfirmations) || config.requiredConfirmations < 1) throw new Error("Konfigurasi registry tidak sah.");
  const chain = defineChain({ id: config.chainId, name: "Report evidence registry", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
  const account = privateKeyToAccount(config.privateKey);
  const rpc = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  const domain: RegistryDomain = { name: "Tawf Report Evidence", version: "1", chainId: config.chainId, verifyingContract: config.address };
  const confirmationPolicy = `block-depth-v1:${config.chainId}:${config.requiredConfirmations}`;
  const base = { confirmationPolicy, requiredConfirmations: config.requiredConfirmations, confirmations: 0 };
  async function assertDeployment() {
    if (await rpc.getChainId() !== config.chainId) throw new Error("Chain registry tidak cocok.");
    const [, name, version, chainId, address] = await rpc.readContract({ address: config.address, abi, functionName: "eip712Domain" });
    if (name !== domain.name || version !== domain.version || chainId !== BigInt(domain.chainId) || address.toLowerCase() !== domain.verifyingContract.toLowerCase()) throw new Error("Domain registry tidak cocok.");
  }
  return {
    domain,
    requiredConfirmations: config.requiredConfirmations,
    confirmationPolicy,
    deployment: `${config.chainId}:${config.address.toLowerCase()}:${account.address.toLowerCase()}`,
    async authority(institutionId: string, signer: Hex) {
      await assertDeployment();
      const [active, epoch] = await rpc.readContract({ address: config.address, abi, functionName: "signatories", args: [keccak256(toHex(institutionId)), signer] });
      const code = await rpc.getCode({ address: signer });
      return { active, epoch: epoch.toString(), accountKind: code && code !== "0x" ? "ERC1271" as const : "EOA" as const };
    },
    async validatorAuthority(signer: Hex) {
      await assertDeployment();
      const [active, epoch] = await rpc.readContract({ address: config.address, abi, functionName: "validators", args: [signer] });
      return { active, epoch: epoch.toString() };
    },
    async publishedVersion(institution: string, report: string, version: string) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "publishedVersion", args: [institution, report, version] });
    },
    async validate(intent: RecordingIntent, signature: Hex) {
      await assertDeployment();
      if (intent.validator) await rpc.readContract({ address: config.address, abi, functionName: "validatePublication", args: [contractAuthorization(intent.authorization), signature, contractAuthorization(intent.validator.authorization), intent.validator.signature] });
      else await rpc.readContract({ address: config.address, abi, functionName: "validateAuthorization", args: [contractAuthorization(intent.authorization), signature] });
    },
    async accountSignatureCall({ to, data }: { to: string; data: Hex }): Promise<string> {
      await assertDeployment();
      return (await rpc.call({ to: to as Hex, data })).data ?? "0x";
    },
    pendingNonce: () => rpc.getTransactionCount({ address: account.address, blockTag: "pending" }),
    async build(intent: RecordingIntent, signature: Hex, nonce: number): Promise<RegistryAttempt> {
      const data = intent.validator
        ? encodeFunctionData({ abi, functionName: "publishReport", args: [contractAuthorization(intent.authorization), signature, contractAuthorization(intent.validator.authorization), intent.validator.signature] })
        : encodeFunctionData({ abi, functionName: "recordEvidence", args: [contractAuthorization(intent.authorization), signature] });
      const tx = await wallet.prepareTransactionRequest({ to: config.address, data, nonce });
      const raw = await wallet.signTransaction(tx);
      return { raw, hash: keccak256(raw), nonce, signature };
    },
    async broadcast(attempt: RegistryAttempt) {
      const hash = await rpc.sendRawTransaction({ serializedTransaction: attempt.raw });
      if (hash !== attempt.hash) throw new Error("Identitas transaksi berubah.");
    },
    async observe(intent: RecordingIntent, hash: Hex): Promise<RecordingObservation> {
      await assertDeployment();
      let receipt;
      try { receipt = await rpc.getTransactionReceipt({ hash }); }
      catch (error) {
        if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
        // A previously observed block may have disappeared. Never retain stale success.
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
      const evidence = { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
      const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
      if (block.hash !== receipt.blockHash) return { ...base, ...evidence, state: "NONCANONICAL" };
      if (receipt.status !== "success") return { ...base, ...evidence, state: "REVERTED" };
      if (receipt.transactionHash !== hash || receipt.to?.toLowerCase() !== config.address.toLowerCase()) return { ...base, ...evidence, state: "INVALID_EVENT" };
      const matches = receipt.logs.filter(log => {
        if (log.removed || log.address.toLowerCase() !== config.address.toLowerCase() || log.transactionHash !== hash || log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber) return false;
        try {
          if (intent.validator) {
            const event = decodeEventLog({ abi, eventName: "ReportPublished", topics: log.topics, data: log.data, strict: true });
            const a = intent.authorization, v = intent.validator;
            return event.args.institutionKey === keccak256(toHex(a.institutionId)) && event.args.packageKey === keccak256(toHex(a.packageId))
              && event.args.authorization === intent.authorizationDigest && event.args.digest === a.digest && event.args.action === a.action
              && event.args.signer.toLowerCase() === a.signer.toLowerCase() && event.args.validatorAuthorization === v.authorizationDigest
              && event.args.validator.toLowerCase() === v.authorization.signer.toLowerCase();
          }
          const event = decodeEventLog({ abi, eventName: "EvidenceRecorded", topics: log.topics, data: log.data, strict: true });
          const a = intent.authorization;
          return event.args.institutionKey === keccak256(toHex(a.institutionId)) && event.args.packageKey === keccak256(toHex(a.packageId))
            && event.args.authorization === intent.authorizationDigest && event.args.digest === a.digest && event.args.action === a.action
            && event.args.signer.toLowerCase() === a.signer.toLowerCase();
        } catch { return false; }
      });
      if (matches.length !== 1 || matches[0]!.logIndex === null) return { ...base, ...evidence, state: "INVALID_EVENT" };
      const head = await rpc.getBlockNumber({ cacheTime: 0 });
      if (head < receipt.blockNumber) return { ...base, ...evidence, state: "NONCANONICAL" };
      const confirmations = Number(head - receipt.blockNumber + 1n);
      return { ...base, ...evidence, confirmations, logIndex: matches[0]!.logIndex!, state: confirmations >= config.requiredConfirmations ? "CONFIRMED" : "INCLUDED" };
    },
  };
}
export type RegistryChain = ReturnType<typeof createRegistryChain>;
