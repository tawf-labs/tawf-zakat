import { validateRegistryBudget, type RegistryBudget, type RegistryBudgetConfig } from "./registry-budget";
import { parseTransaction, recoverTransactionAddress } from "viem";
import type { RegistryReference } from "./registry-read";
import { authorityScope, type AuthorityChange } from "../../shared/report-authority";
import { createPublicClient, createWalletClient, defineChain, http, encodeFunctionData, decodeEventLog, keccak256, toHex, TransactionReceiptNotFoundError, BlockNotFoundError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { reportRegistryAbi as abi } from "../../shared/report-registry-abi";
import { contractAttestation, contractAuthorization, type AttestationIntent, type AttestationStatement, type RecordingIntent, type RegistryDomain, type RecordingObservation } from "../../shared/report-registry";
import { isAttestation, type RegistryAttempt } from "./registry-store";

export type RegistryConfig = { rpcUrl: string; chainId: number; address: Hex; privateKey: Hex; requiredConfirmations: number; budgetConfig?: RegistryBudgetConfig; budget?: RegistryBudget };
/** Everything the relayer can carry: recording, publication and attestation share one durable path. */
export type RegistryIntent = RecordingIntent | AttestationIntent;
function registryAdapter(config: RegistryConfig, reference?: RegistryReference) {
  if (!Number.isSafeInteger(config.chainId) || config.chainId < 1 || !Number.isSafeInteger(config.requiredConfirmations) || config.requiredConfirmations < 1) throw new Error("Konfigurasi registry tidak sah.");
  const chain = defineChain({ id: config.chainId, name: "Report evidence registry", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
  const account = privateKeyToAccount(config.privateKey);
  const client = createPublicClient({ chain, transport: http(config.rpcUrl, { retryCount: 0 }) });
  const blockNumber = reference ? BigInt(reference.blockNumber) : undefined;
  const rpc = {
    ...client,
    readContract: ((args: any) => client.readContract({ ...args, ...(reference ? { blockNumber } : {}) })) as typeof client.readContract,
    getCode: ((args: any) => client.getCode({ ...args, ...(reference ? { blockNumber } : {}) })) as typeof client.getCode,
    getBlockNumber: ((args: any) => reference ? Promise.resolve(blockNumber!) : client.getBlockNumber(args)) as typeof client.getBlockNumber,
    getContractEvents: ((args: any) => client.getContractEvents({ ...args, ...(reference ? { toBlock: blockNumber } : {}) })) as typeof client.getContractEvents,
  };
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  const domain: RegistryDomain = { name: "Tawf Report Evidence", version: "1", chainId: config.chainId, verifyingContract: config.address };
  const confirmationPolicy = `block-depth-v1:${config.chainId}:${config.requiredConfirmations}`;
  const base = { confirmationPolicy, requiredConfirmations: config.requiredConfirmations, confirmations: 0 };
  async function assertDeployment() {
    if (await rpc.getChainId() !== config.chainId) throw new Error("Chain registry tidak cocok.");
    const [, name, version, chainId, address] = await rpc.readContract({ address: config.address, abi, functionName: "eip712Domain" });
    if (name !== domain.name || version !== domain.version || chainId !== BigInt(domain.chainId) || address.toLowerCase() !== domain.verifyingContract.toLowerCase()) throw new Error("Domain registry tidak cocok.");
  }
  async function boundedTransaction(intent: RegistryIntent, signature: Hex, nonce?: number) {
    if (reference || !config.budgetConfig || !config.budget) throw new Error("Relay REPORT dinonaktifkan tanpa anggaran eksplisit.");
    validateRegistryBudget(config.budgetConfig);
    await assertDeployment();
    const data = isAttestation(intent)
      ? encodeFunctionData({ abi, functionName: "attestReport", args: [contractAttestation(intent.statement), signature] })
      : intent.validator
      ? encodeFunctionData({ abi, functionName: "publishReport", args: [contractAuthorization(intent.authorization), signature, contractAuthorization(intent.validator.authorization), intent.validator.signature] })
      : encodeFunctionData({ abi, functionName: "recordEvidence", args: [contractAuthorization(intent.authorization), signature] });
    const { gasLimit: gas, maxFeePerGas } = config.budgetConfig;
    // RPC total gas includes Arbitrum's L1 posting component. No local-EVM substitution.
    const estimate = await rpc.estimateGas({ account: account.address, prepare: false, to: config.address, data, value: 0n, nonce, maxFeePerGas, maxPriorityFeePerGas: 0n });
    if (estimate > gas) throw new Error("Estimasi gas REPORT melebihi batas.");
    return { chainId: config.chainId, to: config.address, data, gas, maxFeePerGas, maxPriorityFeePerGas: 0n, value: 0n, type: "eip1559" as const };
  }
  async function observe(intent: RegistryIntent, hash: Hex, atBlock: bigint | undefined = blockNumber): Promise<RecordingObservation> {
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
      if (atBlock !== undefined && receipt.blockNumber > atBlock) return { ...base, state: "SUBMITTED" };
      const evidence = { blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash };
      const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
      if (block.hash !== receipt.blockHash) return { ...base, ...evidence, state: "NONCANONICAL" };
      const timed = { ...evidence, blockTimestamp: block.timestamp.toString() };
      if (receipt.status !== "success") return { ...base, ...timed, state: "REVERTED" };
      if (receipt.transactionHash !== hash || receipt.to?.toLowerCase() !== config.address.toLowerCase()) return { ...base, ...timed, state: "INVALID_EVENT" };
      const uniqueLogs = [...new Map(receipt.logs.map(log => [JSON.stringify(log, (_, value) => typeof value === "bigint" ? value.toString() : value), log])).values()];
      const matches = uniqueLogs.filter(log => {
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
      const head = atBlock ?? await rpc.getBlockNumber({ cacheTime: 0 });
      if (head < receipt.blockNumber) return { ...base, ...timed, state: "NONCANONICAL" };
      if ((await rpc.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) return { ...base, ...timed, state: "NONCANONICAL" };
      const confirmations = Number(head - receipt.blockNumber + 1n);
      return { ...base, ...timed, confirmations, logIndex: matches[0]!.logIndex!, state: confirmations >= config.requiredConfirmations ? "CONFIRMED" : "INCLUDED" };
    }
  const adapter = {
    readOnly: !!reference,
    domain,
    async readHead() {
      const block = await client.getBlock({ blockTag: "latest" });
      return { blockNumber: block.number.toString(), blockHash: block.hash };
    },
    recoveryDeployment: `${config.chainId}:${config.address.toLowerCase()}`,
    async recoveryHead() {
      await assertDeployment();
      const block = await rpc.getBlock({ blockTag: "latest" });
      return { blockNumber: block.number.toString(), blockHash: block.hash };
    },
    async canonicalBlock(number: string) {
      try { return (await rpc.getBlock({ blockNumber: BigInt(number) })).hash; }
      catch (error) { if (error instanceof BlockNotFoundError) return null; throw error; }
    },
    async recoveryEvents(institution: string, from: bigint, to: bigint) {
      const events: import("./registry-recovery-store").RegistryEvent[] = [];
      const scope = keccak256(toHex(institution));
      const blocks = new Map<string, Hex | null>();
      for (let start = from; start <= to; start += 2000n) {
        const end = start + 1999n < to ? start + 1999n : to;
        const logs = await rpc.getContractEvents({ address: config.address, abi, fromBlock: start, toBlock: end, strict: true });
        for (const log of logs) {
          if (!["EvidenceRecorded", "ReportPublished", "ReportAttested"].includes(log.eventName)) continue;
          if ((log.args as { institutionKey?: Hex }).institutionKey !== scope) continue;
          if (log.removed || log.logIndex === null || !log.transactionHash || !log.blockHash || log.blockNumber === null
            || log.address.toLowerCase() !== config.address.toLowerCase() || log.blockNumber < start || log.blockNumber > end) throw new Error("Event registry tidak sah.");
          const number = log.blockNumber.toString();
          if (!blocks.has(number)) blocks.set(number, (await rpc.getBlock({ blockNumber: log.blockNumber })).hash);
          if (blocks.get(number) !== log.blockHash) throw new Error("Event bukan bagian chain canonical.");
          events.push({ chainId: config.chainId, registry: config.address.toLowerCase(), transactionHash: log.transactionHash,
            logIndex: log.logIndex, blockNumber: number, blockHash: log.blockHash, event: log.eventName });
        }
      }
      return events;
    },
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
    async prepareAuthorityChange(institution: string, actor: Hex, change: AuthorityChange) {
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
      return { actor, scope: authorityScope(change, institution),
        change, chainId: config.chainId, to: config.address, data, value: "0" };
    },
    async authorityHistory(institution: string, fromBlock: bigint) {
      await assertDeployment();
      const head = await rpc.getBlockNumber({ cacheTime: 0 });
      const toBlock = fromBlock + 1999n < head ? fromBlock + 1999n : head;
      if (fromBlock > head) return { events: [], nextBlock: fromBlock.toString() };
      const events = await rpc.getContractEvents({ address: config.address, abi, fromBlock, toBlock });
      const scope = keccak256(toHex(institution));
      const historyEvents = ["AuthorityChanged", "AdministratorProposed", "AdministratorAccepted", "ValidatorOperatorProposed", "ValidatorOperatorAccepted"];
      return { events: events.filter(event => {
        if (!historyEvents.includes(event.eventName)) return false;
        const args = event.args as { scope?: Hex; institutionKey?: Hex };
        const eventScope = args.scope ?? args.institutionKey;
        return !eventScope || eventScope === scope || eventScope === `0x${"0".repeat(64)}`;
      }).map(event => JSON.parse(JSON.stringify({
        event: event.eventName, ...event.args, blockNumber: event.blockNumber, blockHash: event.blockHash,
        transactionHash: event.transactionHash, logIndex: event.logIndex,
      }, (_, value) => typeof value === "bigint" ? value.toString() : value))), nextBlock: (toBlock + 1n).toString() };

    },
    async authorityReceipt(hash: Hex) {
      await assertDeployment();
      const receipt = await rpc.getTransactionReceipt({ hash });
      const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
      if (receipt.blockHash !== block.hash) throw new Error("Receipt tidak kanonik.");
      const events = receipt.logs.filter(log => log.address.toLowerCase() === config.address.toLowerCase()).flatMap(log => {
        try {
          const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data });
          if (!["AuthorityChanged", "AdministratorProposed", "ValidatorOperatorProposed", "ValidatorOperatorAccepted", "AdministratorAccepted"].includes(decoded.eventName)) return [];
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
        const statement = { ...record.statement, authorityEpoch: record.statement.authorityEpoch.toString(), deadline: record.statement.deadline.toString() } as AttestationStatement;
        const logs = await rpc.getContractEvents({ address: config.address, abi, eventName: "ReportAttested", fromBlock: 0n, toBlock: "latest", args: { attestation: id } });
        const log = logs.find(log => !log.removed && log.transactionHash);
        if (!log?.transactionHash) throw new Error("Event atestasi belum dapat diperiksa.");
        const intent = { statement, statementDigest: id, observation: { ...base, state: "PREPARED" } } as AttestationIntent;
        const observation = await observe(intent, log.transactionHash, blockNumber);
        if (observation.state === "CONFIRMED") records.push({ id, statement: record.statement, signature: record.signature, mandate: record.mandate, observation });
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
    // Pure checks run before nonce allocation; build repeats them against the allocated nonce.
    async preflight(intent: RegistryIntent, signature: Hex) { await boundedTransaction(intent, signature); },
    async build(intent: RegistryIntent, signature: Hex, nonce: number): Promise<RegistryAttempt> {
      const tx = { ...await boundedTransaction(intent, signature, nonce), nonce };
      await config.budget!.reserve({ ...tx, sender: account.address });
      const raw = await config.budget!.signed({ ...tx, sender: account.address }, () => wallet.signTransaction(tx));
      return { raw, hash: keccak256(raw), nonce, signature };
    },
    async broadcast(attempt: RegistryAttempt) {
      if (reference || !config.budgetConfig || !config.budget) throw new Error("Relay REPORT dinonaktifkan tanpa anggaran eksplisit.");
      await assertDeployment();
      const tx = parseTransaction(attempt.raw);
      if (tx.type !== "eip1559" || tx.accessList?.length || tx.chainId !== config.chainId || tx.to?.toLowerCase() !== config.address.toLowerCase()
        || tx.nonce !== Number(attempt.nonce) || keccak256(attempt.raw) !== attempt.hash) throw new Error("Transaksi REPORT tidak diizinkan.");
      const sender = await recoverTransactionAddress({ serializedTransaction: attempt.raw as `0x02${string}` });
      if (sender.toLowerCase() !== account.address.toLowerCase()) throw new Error("Transaksi REPORT tidak diizinkan.");
      await config.budget.authorize({ chainId: tx.chainId, to: tx.to!, sender, nonce: tx.nonce!, data: tx.data ?? "0x",
        gas: tx.gas!, maxFeePerGas: tx.maxFeePerGas!, maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? 0n, value: tx.value ?? 0n }, attempt.raw);
      const hash = await rpc.sendRawTransaction({ serializedTransaction: attempt.raw });
      if (hash !== attempt.hash) throw new Error("Identitas transaksi berubah.");
    },
    observe,
    /** Whether this deployment may send transactions at all: the relay refuses without an explicit budget. */
    relayEnabled: Boolean(config.budgetConfig && config.budget),
  };
  return adapter;
}
export type RegistryChain = ReturnType<typeof registryAdapter> & { readAt(reference: RegistryReference): RegistryChain };
export function createRegistryChain(config: RegistryConfig): RegistryChain {
  const at = (reference?: RegistryReference): RegistryChain => ({
    ...registryAdapter(config, reference),
    readAt: next => memoizedRead(at(next)),
  });
  return at();
}

/** Request-local cache: never shared with action validation or recovery checkpoints. */
function memoizedRead(chain: RegistryChain): RegistryChain {
  const cache = new Map<string, Promise<any>>();
  const memo = <K extends keyof RegistryChain>(key: K): RegistryChain[K] => ((...args: any[]) => {
    const identity = key + ":" + JSON.stringify(args, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    if (!cache.has(identity)) cache.set(identity, (chain[key] as (...args: any[]) => Promise<any>)(...args));
    return cache.get(identity)!;
  }) as RegistryChain[K];
  return { ...chain, observe: memo("observe"), receipt: memo("receipt"), officialLine: memo("officialLine"),
    publishedVersion: memo("publishedVersion"), publishedPackageVersion: memo("publishedPackageVersion"),
    versionAttestations: memo("versionAttestations") };
}
