import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, decodeEventLog, keccak256, toHex, TransactionReceiptNotFoundError, BlockNotFoundError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { reportRegistryAbi as abi } from "../../shared/report-registry-abi";
import { contractAttestation, contractAuthorization, type AttestationIntent, type AttestationStatement, type RecordingIntent, type RegistryDomain, type RecordingObservation } from "../../shared/report-registry";
import { isAttestation, type RegistryAttempt } from "./registry-store";

export type RegistryConfig = { rpcUrl: string; chainId: number; address: Hex; privateKey: Hex; requiredConfirmations: number };
/** Everything the relayer can carry: recording, publication and attestation share one durable path. */
export type RegistryIntent = RecordingIntent | AttestationIntent;
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
    async authoritySnapshot(institution: string, subject: Hex) {
      await assertDeployment();
      const blockNumber = await rpc.getBlockNumber({ cacheTime: 0 });
      const read = (functionName: string, args: unknown[] = []) => rpc.readContract({ address: config.address, abi, functionName, args, blockNumber } as never) as Promise<any>;
      const key = keccak256(toHex(institution));
      const [administrator, pendingAdministrator, administratorEpoch, operator, pendingOperator, operatorEpoch, signatory, validator, auditor, mandate] = await Promise.all([
        read("administrators", [key]), read("pendingAdministrators", [key]), read("administratorEpochs", [key]),
        read("validatorOperator"), read("pendingValidatorOperator"), read("validatorOperatorEpoch"),
        read("signatories", [key, subject]), read("validators", [subject]), read("auditors", [key, subject]), read("auditorMandate", [institution, subject]),
      ]);
      const role = ([active, epoch]: [boolean, bigint]) => ({ active, epoch: epoch.toString() });
      return { institution, subject, blockNumber: blockNumber.toString(), domain, administrator, pendingAdministrator,
        administratorEpoch: administratorEpoch.toString(), operator, pendingOperator, operatorEpoch: operatorEpoch.toString(),
        signatory: role(signatory), validator: role(validator), auditor: { ...role(auditor), mandate } };
    },
    /** The caller's wallet executes; the technical relayer never impersonates a role manager. */
    async prepareAuthorityChange(institution: string, actor: Hex, change: import("./report-authority-input").AuthorityChange) {
      await assertDeployment();
      let functionName: string, args: unknown[];
      switch (change.action) {
        case "SIGNATORY": functionName = "setSignatory"; args = [institution, change.account, change.active]; break;
        case "AUDITOR": functionName = "setAuditor"; args = [institution, change.account, change.active, change.mandate]; break;
        case "VALIDATOR": functionName = "setValidator"; args = [change.account, change.active]; break;
        case "PROPOSE_ADMINISTRATOR": functionName = "proposeAdministrator"; args = [institution, change.account]; break;
        case "ACCEPT_ADMINISTRATOR": functionName = "acceptAdministrator"; args = [institution]; break;
        case "PROPOSE_VALIDATOR_OPERATOR": functionName = "proposeValidatorOperator"; args = [change.account]; break;
        case "ACCEPT_VALIDATOR_OPERATOR": functionName = "acceptValidatorOperator"; args = []; break;
      }
      const data = encodeFunctionData({ abi, functionName, args } as never);
      await rpc.call({ account: actor, to: config.address, data });
      return { actor, scope: change.action.includes("VALIDATOR") ? "GLOBAL_VALIDATOR_SERVICE" : institution,
        change, chainId: config.chainId, to: config.address, data, value: "0" };
    },
    async authorityHistory(institution: string, fromBlock: bigint) {
      await assertDeployment();
      const head = await rpc.getBlockNumber({ cacheTime: 0 });
      const toBlock = fromBlock + 1999n < head ? fromBlock + 1999n : head;
      if (fromBlock > head) return { events: [], nextBlock: fromBlock.toString() };
      const events = await rpc.getContractEvents({ address: config.address, abi, eventName: "AuthorityChanged", fromBlock, toBlock });
      const scope = keccak256(toHex(institution));
      return { events: events.filter(event => event.args.scope === scope || event.args.scope === `0x${"0".repeat(64)}`).map(event => ({
        ...event.args, epoch: event.args.epoch?.toString(), actorEpoch: event.args.actorEpoch?.toString(),
        blockNumber: event.blockNumber.toString(), blockHash: event.blockHash, transactionHash: event.transactionHash, logIndex: event.logIndex,
      })), nextBlock: (toBlock + 1n).toString() };
    },
    async authorityReceipt(hash: Hex) {
      await assertDeployment();
      const receipt = await rpc.getTransactionReceipt({ hash });
      const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
      if (receipt.blockHash !== block.hash) throw new Error("Receipt tidak kanonik.");
      const events = receipt.logs.filter(log => log.address.toLowerCase() === config.address.toLowerCase()).flatMap(log => {
        try {
          const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data });
          if (!["AuthorityChanged", "AdministratorProposed", "ValidatorOperatorProposed", "AdministratorAccepted"].includes(decoded.eventName)) return [];
          return [{ event: decoded.eventName, args: decoded.args, logIndex: log.logIndex }];
        } catch { return []; }
      });
      if (!events.length || receipt.status !== "success") throw new Error("Transaksi tidak menerima perubahan otoritas registry.");
      const confirmations = Number(await rpc.getBlockNumber({ cacheTime: 0 }) - receipt.blockNumber + 1n);
      return JSON.parse(JSON.stringify({ hash, blockHash: block.hash, blockNumber: block.number, timestamp: block.timestamp,
        state: confirmations >= config.requiredConfirmations ? "CONFIRMED" : "INCLUDED", confirmations, requiredConfirmations: config.requiredConfirmations, events },
        (_, value) => typeof value === "bigint" ? value.toString() : value));
    },
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
    async receipt(hash: Hex) {
      await assertDeployment();
      return rpc.getTransactionReceipt({ hash });
    },
    async publishedVersion(institution: string, report: string, version: string) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "publishedVersion", args: [institution, report, version] });
    },
    /** Which package the registry currently treats as official; display numbering never decides this. */
    async officialLine(institution: string, report: string) {
      await assertDeployment();
      const [packageId, version] = await Promise.all([
        rpc.readContract({ address: config.address, abi, functionName: "latestPublishedPackage", args: [institution, report] }),
        rpc.readContract({ address: config.address, abi, functionName: "latestPublishedVersion", args: [institution, report] }),
      ]);
      return { packageId, version };
    },
    async publishedPackageVersion(institution: string, packageId: string) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "publishedPackageVersion", args: [institution, packageId] });
    },
    /** An engagement scope recorded by the institution being examined; never evidence of independence. */
    async auditorAuthority(institution: string, auditor: Hex) {
      await assertDeployment();
      const [[active, epoch], mandate, code] = await Promise.all([
        rpc.readContract({ address: config.address, abi, functionName: "auditors", args: [keccak256(toHex(institution)), auditor] }),
        rpc.readContract({ address: config.address, abi, functionName: "auditorMandate", args: [institution, auditor] }),
        rpc.getCode({ address: auditor }),
      ]);
      return { active, epoch: epoch.toString(), mandate, accountKind: code && code !== "0x" ? "ERC1271" as const : "EOA" as const };
    },
    async attestationRecord(id: Hex) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "attestationById", args: [id] });
    },
    /** Attestations are addressed by version identity; a report id alone never reaches them. */
    async versionAttestations(institution: string, report: string, version: string) {
      await assertDeployment();
      const count = await rpc.readContract({ address: config.address, abi, functionName: "attestationCount", args: [institution, report, version] });
      const records = [];
      for (let index = 0n; index < count; index++) {
        const id = await rpc.readContract({ address: config.address, abi, functionName: "attestationIdAt", args: [institution, report, version, index] });
        const record = await rpc.readContract({ address: config.address, abi, functionName: "attestationById", args: [id] });
        records.push({ id, statement: record.statement, signature: record.signature, mandate: record.mandate });
      }
      return records;
    },
    async validate(intent: RegistryIntent, signature: Hex) {
      await assertDeployment();
      if (isAttestation(intent)) await rpc.readContract({ address: config.address, abi, functionName: "validateAttestation", args: [contractAttestation(intent.statement), signature] });
      else if (intent.validator) await rpc.readContract({ address: config.address, abi, functionName: "validatePublication", args: [contractAuthorization(intent.authorization), signature, contractAuthorization(intent.validator.authorization), intent.validator.signature] });
      else await rpc.readContract({ address: config.address, abi, functionName: "validateAuthorization", args: [contractAuthorization(intent.authorization), signature] });
    },
    async attestationDigest(statement: AttestationStatement) {
      await assertDeployment();
      return rpc.readContract({ address: config.address, abi, functionName: "attestationDigest", args: [contractAttestation(statement)] });
    },
    async accountSignatureCall({ to, data }: { to: string; data: Hex }): Promise<string> {
      await assertDeployment();
      return (await rpc.call({ to: to as Hex, data })).data ?? "0x";
    },
    pendingNonce: () => rpc.getTransactionCount({ address: account.address, blockTag: "pending" }),
    async build(intent: RegistryIntent, signature: Hex, nonce: number): Promise<RegistryAttempt> {
      const data = isAttestation(intent)
        ? encodeFunctionData({ abi, functionName: "attestReport", args: [contractAttestation(intent.statement), signature] })
        : intent.validator
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
    async observe(intent: RegistryIntent, hash: Hex): Promise<RecordingObservation> {
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
      const timed = { ...evidence, blockTimestamp: block.timestamp.toString() };
      if (receipt.status !== "success") return { ...base, ...timed, state: "REVERTED" };
      if (receipt.transactionHash !== hash || receipt.to?.toLowerCase() !== config.address.toLowerCase()) return { ...base, ...timed, state: "INVALID_EVENT" };
      const matches = receipt.logs.filter(log => {
        if (log.removed || log.address.toLowerCase() !== config.address.toLowerCase() || log.transactionHash !== hash || log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber) return false;
        try {
          if (isAttestation(intent)) {
            const event = decodeEventLog({ abi, eventName: "ReportAttested", topics: log.topics, data: log.data, strict: true });
            const a = intent.statement;
            return event.args.institutionKey === keccak256(toHex(a.institutionId)) && event.args.packageKey === keccak256(toHex(a.packageId))
              && event.args.attestation === intent.statementDigest && event.args.action === a.action
              && event.args.packageDigest === a.packageDigest && event.args.evidenceCommitment === a.evidenceCommitment
              && event.args.predecessor === a.predecessor && event.args.auditor.toLowerCase() === a.auditor.toLowerCase();
          }
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
      if (matches.length !== 1 || matches[0]!.logIndex === null) return { ...base, ...timed, state: "INVALID_EVENT" };
      const head = await rpc.getBlockNumber({ cacheTime: 0 });
      if (head < receipt.blockNumber) return { ...base, ...timed, state: "NONCANONICAL" };
      const confirmations = Number(head - receipt.blockNumber + 1n);
      return { ...base, ...timed, confirmations, logIndex: matches[0]!.logIndex!, state: confirmations >= config.requiredConfirmations ? "CONFIRMED" : "INCLUDED" };
    },
  };
}
export type RegistryChain = ReturnType<typeof createRegistryChain>;
