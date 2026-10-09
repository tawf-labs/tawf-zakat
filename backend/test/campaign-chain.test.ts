import { describe, expect, test } from "bun:test";
import { createPublicClient, createTestClient, createWalletClient, http, keccak256, toHex, zeroHash, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import {
  CAMPAIGN_REGISTRY_ABI, campaignEvidenceArgs, createCampaignChainRecorder, createCampaignChainRecorderFromEnv, parseCampaignChainConfig,
  type CampaignChainTransport,
} from "../src/campaign-chain";
import { withOwnedAnvil } from "../src/scripts/pilot-deployment-simulate";

const address = "0x1111111111111111111111111111111111111111" as Address;
const account = "0x2222222222222222222222222222222222222222" as Address;
const hash = `0x${"ab".repeat(32)}` as Hex;
const replacementHash = `0x${"cd".repeat(32)}` as Hex;
const blockHash = `0x${"ef".repeat(32)}` as Hex;
const input = { eventId: "event-1", campaignId: "campaign-1", kind: "PAYMENT_SETTLED", payloadHash: hash };
const env = {
  CAMPAIGN_REGISTRY_ADDRESS: address,
  CAMPAIGN_CHAIN_RPC_URL: "http://127.0.0.1:8545",
  CAMPAIGN_RECORDER_PRIVATE_KEY: `0x${"01".repeat(32)}`,
};
const receipt = { status: "success", transactionHash: hash, blockNumber: 10n, blockHash, to: address, from: account };
function fixture(overrides: Partial<CampaignChainTransport> = {}) {
  const calls: string[] = [];
  const transport: CampaignChainTransport = {
    async getChainId() { calls.push("chain"); return 31337; },
    async getBytecode() { calls.push("code"); return "0x6000"; },
    async submit(args) { calls.push("submit"); expect(args).toEqual(campaignEvidenceArgs(input)); return hash; },
    async waitForReceipt() { calls.push("receipt"); return receipt; },
    async readEvidence(eventId, blockNumber) {
      calls.push("evidence"); expect(eventId).toBe(keccak256(toHex(input.eventId))); expect(blockNumber).toBe(10n);
      return campaignEvidenceArgs(input).slice(1) as [Hex, Hex, Hex];
    },
    async getBlockHash() { calls.push("block"); return blockHash; },
    ...overrides,
  };
  return { calls, recorder: createCampaignChainRecorder({ address, chainId: 31337 }, account, transport) };
}

test("real owned local EVM deploys registry, confirms adapter writes and retries, and rejects conflicts/unauthorized writes", async () => {
  // Offline compilation and fresh owned Anvil only: no fork URL, ambient keys, or external RPC.
  const build = Bun.spawn(["forge", "build", "src/CampaignEvidenceRegistry.sol", "--offline"], {
    cwd: new URL("../../sc/", import.meta.url).pathname,
    env: { PATH: process.env.PATH ?? "" }, stdin: "ignore", stdout: "ignore", stderr: "pipe",
  });
  const buildError = await new Response(build.stderr).text();
  if (await build.exited !== 0) throw new Error(`Offline registry compilation failed: ${buildError}`);
  const artifact = await Bun.file(new URL("../../sc/out/CampaignEvidenceRegistry.sol/CampaignEvidenceRegistry.json", import.meta.url)).json();
  const bytecode = artifact.bytecode.object as Hex;
  expect(bytecode.startsWith("0x")).toBe(true);
  // Public Anvil development mnemonic, never a credential from the caller's environment.
  const mnemonic = "test test test test test test test test test test test junk";
  const recorderAccount = mnemonicToAccount(mnemonic);
  const admin = mnemonicToAccount(mnemonic, { addressIndex: 1 });
  const privateKey = toHex(recorderAccount.getHdKey().privateKey!);
  let ownedUrl = "";
  await withOwnedAnvil({}, async url => {
    ownedUrl = url;
    const transport = http(url, { retryCount: 0 });
    const rpc = createPublicClient({ chain: arbitrumSepolia, transport });
    const local = createTestClient({ chain: arbitrumSepolia, mode: "anvil", transport });
    // Existing owned-Anvil helper starts with zero accounts. Fund only public dev accounts locally.
    await local.setBalance({ address: admin.address, value: 10n ** 20n });
    await local.setBalance({ address: recorderAccount.address, value: 10n ** 20n });
    const wallet = createWalletClient({ chain: arbitrumSepolia, account: admin, transport });
    const deployment = await wallet.deployContract({ abi: CAMPAIGN_REGISTRY_ABI, bytecode, args: [admin.address, recorderAccount.address] });
    const deployed = await rpc.waitForTransactionReceipt({ hash: deployment });
    expect(deployed.status).toBe("success");
    const registryAddress = deployed.contractAddress!;
    const localEnv = {
      CAMPAIGN_CHAIN_ID: "421614", CAMPAIGN_CHAIN_RPC_URL: url,
      CAMPAIGN_REGISTRY_ADDRESS: registryAddress, CAMPAIGN_RECORDER_PRIVATE_KEY: privateKey,
    };
    const recorder = createCampaignChainRecorderFromEnv(localEnv)!;
    const contract = { address: registryAddress, abi: CAMPAIGN_REGISTRY_ABI } as const;
    const args = campaignEvidenceArgs(input);
    const first = await recorder.record(input);
    const confirmed = await rpc.getTransactionReceipt({ hash: first.transactionHash as Hex });
    expect(confirmed.status).toBe("success");
    expect(confirmed.from.toLowerCase()).toBe(recorderAccount.address.toLowerCase());
    expect(confirmed.to?.toLowerCase()).toBe(registryAddress.toLowerCase());
    expect(await rpc.readContract({ ...contract, functionName: "evidence", args: [args[0]] })).toEqual([args[1], args[2], args[3]]);
    const replay = await recorder.record(input);
    expect(replay.transactionHash).not.toBe(first.transactionHash);
    const replayReceipt = await rpc.getTransactionReceipt({ hash: replay.transactionHash as Hex });
    expect(replayReceipt.status).toBe("success");
    expect(replayReceipt.logs).toHaveLength(0);
    const logs = await rpc.getContractEvents({ ...contract, eventName: "EvidenceRecorded", fromBlock: 0n, toBlock: "latest" });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.args).toEqual({ eventId: args[0], campaignId: args[1], kind: args[2], payloadHash: args[3] });
    await expect(recorder.record({ ...input, payloadHash: replacementHash })).rejects.toThrow();
    const unauthorized = createCampaignChainRecorderFromEnv({ ...localEnv, CAMPAIGN_RECORDER_PRIVATE_KEY: toHex(admin.getHdKey().privateKey!) })!;
    await expect(unauthorized.record(input)).rejects.toThrow();
    // A fresh recorder instance recovers after a process restart through another confirmed retry.
    const recovered = await createCampaignChainRecorderFromEnv(localEnv)!.record(input);
    expect((await rpc.getTransactionReceipt({ hash: recovered.transactionHash as Hex })).status).toBe("success");
    expect(await rpc.readContract({ ...contract, functionName: "evidence", args: [args[0]] })).toEqual([args[1], args[2], args[3]]);
  });
  await expect(fetch(ownedUrl, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
}, 60_000);

describe("campaign chain configuration", () => {
  test("disabled only when every dedicated variable is absent; never reuses custody config", () => {
    expect(parseCampaignChainConfig({ PRIVATE_KEY: "unrelated", RPC_URL: "https://mainnet.example" })).toBeNull();
    expect(parseCampaignChainConfig(env)?.chainId).toBe(421614);
    expect(parseCampaignChainConfig({ ...env, CAMPAIGN_CHAIN_ID: "31337" })?.chainId).toBe(31337);
  });
  test("partial, blank, mainnet, malformed address/RPC/key configurations fail closed", () => {
    for (const invalid of [
      { CAMPAIGN_CHAIN_ID: "31337" }, { CAMPAIGN_REGISTRY_ADDRESS: "" },
      { ...env, CAMPAIGN_CHAIN_ID: "1" }, { ...env, CAMPAIGN_CHAIN_ID: "42161" },
      { ...env, CAMPAIGN_CHAIN_ID: "" }, { ...env, CAMPAIGN_REGISTRY_ADDRESS: "0x123" },
      { ...env, CAMPAIGN_REGISTRY_ADDRESS: `0x${"00".repeat(20)}` },
      { ...env, CAMPAIGN_CHAIN_RPC_URL: "garbage" }, { ...env, CAMPAIGN_CHAIN_RPC_URL: "file:///a" },
      { ...env, CAMPAIGN_RECORDER_PRIVATE_KEY: "secret" },
      { ...env, CAMPAIGN_RECORDER_PRIVATE_KEY: zeroHash },
      { ...env, CAMPAIGN_RECORDER_PRIVATE_KEY: `0x${"ff".repeat(32)}` },
    ]) expect(() => parseCampaignChainConfig(invalid)).toThrow();
  });
});

describe("campaign evidence encoding", () => {
  test("hashes UTF-8 IDs and kind; preserves and normalizes the payload commitment", () => {
    expect(campaignEvidenceArgs(input)).toEqual([
      keccak256(toHex(input.eventId)), keccak256(toHex(input.campaignId)), keccak256(toHex(input.kind)), hash,
    ]);
    expect(campaignEvidenceArgs({ ...input, payloadHash: `0x${"AB".repeat(32)}` })[3]).toBe(hash);
    expect(campaignEvidenceArgs({ ...input, kind: "DISBURSEMENT_RECORDED" })[2]).not.toBe(campaignEvidenceArgs(input)[2]);
  });
  test("rejects empty identifiers, malformed payload and zero commitment", () => {
    for (const invalid of [
      { ...input, eventId: "" }, { ...input, campaignId: " " }, { ...input, kind: "" },
      { ...input, payloadHash: "0x01" }, { ...input, payloadHash: zeroHash },
    ]) expect(() => campaignEvidenceArgs(invalid)).toThrow();
  });
});

describe("campaign recorder confirmation", () => {
  test("checks chain/code, waits for receipt and checks stored evidence and canonical block", async () => {
    const { recorder, calls } = fixture();
    expect(await recorder.record(input)).toEqual({ transactionHash: hash });
    expect(calls).toEqual(["chain", "code", "submit", "receipt", "evidence", "block"]);
  });
  test("retries submit an idempotent call and confirm again, not a cached transaction hash", async () => {
    const { recorder, calls } = fixture();
    await recorder.record(input);
    await recorder.record(input);
    expect(calls.filter(c => c === "submit")).toHaveLength(2);
    expect(calls.filter(c => c === "receipt")).toHaveLength(2);
  });
  test("wrong RPC chain or missing bytecode prevents any write", async () => {
    for (const overrides of [
      { getChainId: async () => 1 }, { getBytecode: async () => undefined }, { getBytecode: async () => "0x" as Hex },
    ]) {
      const { recorder, calls } = fixture(overrides);
      await expect(recorder.record(input)).rejects.toThrow();
      expect(calls).not.toContain("submit");
    }
  });
  test("simulation/write conflict or unauthorized failure propagates", async () => {
    const { recorder, calls } = fixture({ async submit() { throw new Error("EvidenceConflict / Unauthorized"); } });
    await expect(recorder.record(input)).rejects.toThrow("EvidenceConflict");
    expect(calls).not.toContain("receipt");
  });
  test("pending receipt timeout never reports confirmation", async () => {
    const { recorder } = fixture({ async waitForReceipt() { throw new Error("receipt timeout"); } });
    await expect(recorder.record(input)).rejects.toThrow("timeout");
  });
  test("does not resolve while receipt is pending", async () => {
    let release!: (value: typeof receipt) => void;
    const pending = new Promise<typeof receipt>(resolve => { release = resolve; });
    const { recorder } = fixture({ waitForReceipt: async () => pending });
    let confirmed = false;
    const result = recorder.record(input).then(value => { confirmed = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(confirmed).toBe(false);
    release(receipt);
    expect(await result).toEqual({ transactionHash: hash });
  });
  test("reverted, wrong-target and wrong-sender receipts fail", async () => {
    for (const bad of [{ ...receipt, status: "reverted" }, { ...receipt, to: account }, { ...receipt, to: null }, { ...receipt, from: address }]) {
      const { recorder } = fixture({ waitForReceipt: async () => bad });
      await expect(recorder.record(input)).rejects.toThrow();
    }
  });
  test("different or absent stored evidence and reorg fail", async () => {
    for (const overrides of [
      { readEvidence: async () => [zeroHash, zeroHash, zeroHash] as const },
      { getBlockHash: async () => replacementHash },
    ]) await expect(fixture(overrides).recorder.record(input)).rejects.toThrow();
  });
  test("repricing returns the confirmed replacement hash", async () => {
    const { recorder } = fixture({ async waitForReceipt(_hash, onReplaced) {
      onReplaced("repriced"); return { ...receipt, transactionHash: replacementHash };
    } });
    expect(await recorder.record(input)).toEqual({ transactionHash: replacementHash });
  });
  test("cancelled or different-data replacements fail even with successful receipts", async () => {
    for (const reason of ["cancelled", "replaced"]) {
      const { recorder } = fixture({ async waitForReceipt(_hash, onReplaced) {
        onReplaced(reason); return { ...receipt, transactionHash: replacementHash };
      } });
      await expect(recorder.record(input)).rejects.toThrow("cancelled or replaced");
    }
  });
});
