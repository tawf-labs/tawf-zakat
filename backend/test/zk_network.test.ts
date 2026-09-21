import { afterAll, describe, expect, it } from "bun:test";
import { parseTransaction, type Hex } from "viem";
import { zkNetworkFromEnvironment } from "../src/zk-network";

// Synthetic key only. The RPC below never forwards requests to a public network.
const key = `0x${"11".repeat(32)}`;
const address = `0x${"22".repeat(20)}`;
const local = { ZK_RPC_URL: "http://127.0.0.1:8545", ZK_REGISTRY_ADDRESS: address, ZK_RELAY_PRIVATE_KEY: key };
let chainId = "0x66eee";
let unavailable = false;
const calls: string[] = [];
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
  const body = await request.json() as { id: number; method: string };
  calls.push(body.method);
  return Response.json(unavailable
    ? { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "secret upstream details" } }
    : { jsonrpc: "2.0", id: body.id, result: body.method === "eth_chainId" ? chainId : `0x${"33".repeat(32)}` });
} });
afterAll(() => server.stop(true));
const configured = () => zkNetworkFromEnvironment({ ...local, ZK_RPC_URL: `http://127.0.0.1:${server.port}`, ZK_CHAIN_ID: "421614" })!;
const transaction = { to: address as Hex, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 0n, nonce: 0, value: 0n, type: "eip1559" as const };

describe("explicit, fail-closed ZK network", () => {
  it("leaves an absent configuration disabled and preserves loopback foundry defaults", () => {
    expect(zkNetworkFromEnvironment({})).toBeUndefined();
    expect(zkNetworkFromEnvironment(local)!.zkPublicClient.chain.id).toBe(31337);
    for (const host of ["localhost", "[::1]"]) {
      expect(zkNetworkFromEnvironment({ ...local, ZK_RPC_URL: `http://${host}:8545` })!.zkPublicClient.chain.id).toBe(31337);
    }
  });
  it("permits remote HTTPS only with explicit Arbitrum Sepolia selection", () => {
    const remote = { ...local, ZK_RPC_URL: "https://rpc.example.test" };
    expect(() => zkNetworkFromEnvironment(remote)).toThrow();
    expect(zkNetworkFromEnvironment({ ...remote, ZK_CHAIN_ID: "421614" })!.zkWalletClient.chain.id).toBe(421614);
    expect(() => zkNetworkFromEnvironment({ ...remote, ZK_CHAIN_ID: "31337" })).toThrow();
  });
  it("rejects partial or empty configuration without exposing values", () => {
    for (const name of Object.keys(local)) {
      const partial: Record<string, string> = { ...local }; delete partial[name];
      expect(() => zkNetworkFromEnvironment(partial)).toThrow();
      expect(() => zkNetworkFromEnvironment({ ...local, [name]: "" })).toThrow();
    }
    expect(() => zkNetworkFromEnvironment({ ZK_CHAIN_ID: "421614" })).toThrow();
  });
  it("rejects invalid and unsupported chain IDs including mainnets", () => {
    for (const id of ["", "1", "42161", "11155111", "0", "-1", "421614.0", "0x66eee", " 421614", "NaN", "9007199254740993"]) {
      expect(() => zkNetworkFromEnvironment({ ...local, ZK_CHAIN_ID: id })).toThrow();
    }
  });
  it("rejects unsafe URLs, zero/invalid registry and malformed/out-of-range keys", () => {
    for (const url of ["invalid", "ftp://localhost", "http://rpc.example.test", "https://localhost.evil.test"]) {
      expect(() => zkNetworkFromEnvironment({ ...local, ZK_RPC_URL: url })).toThrow();
    }
    for (const value of ["bad", `0x${"00".repeat(20)}`]) expect(() => zkNetworkFromEnvironment({ ...local, ZK_REGISTRY_ADDRESS: value })).toThrow();
    for (const value of ["secret", `0x${"00".repeat(32)}`, `0x${"ff".repeat(32)}`]) {
      try { zkNetworkFromEnvironment({ ...local, ZK_RELAY_PRIVATE_KEY: value }); throw new Error("accepted"); }
      catch (error) { expect((error as Error).message).toBe("Konfigurasi jaringan ZK harus lengkap dan sah."); }
    }
  });
  it("checks live chain before offline signing and before broadcast, without caching", async () => {
    unavailable = false; chainId = "0x66eee"; calls.length = 0;
    const runtime = configured();
    const raw = await runtime.zkWalletClient.signTransaction(transaction);
    expect(parseTransaction(raw).chainId).toBe(421614);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(method => method === "eth_chainId")).toBe(true);
    chainId = "0x1"; calls.length = 0;
    await expect(runtime.zkWalletClient.signTransaction(transaction)).rejects.toThrow();
    await expect(runtime.zkPublicClient.sendRawTransaction({ serializedTransaction: raw })).rejects.toThrow();
    await expect(runtime.zkPublicClient.getChainId()).rejects.toThrow();
    await expect(runtime.zkPublicClient.getTransactionReceipt({ hash: `0x${"33".repeat(32)}` })).rejects.toThrow();
    expect(calls.every(method => method === "eth_chainId")).toBe(true);
    chainId = "0x66eee"; calls.length = 0;
    await runtime.zkPublicClient.sendRawTransaction({ serializedTransaction: raw });
    expect(calls).toEqual(["eth_chainId", "eth_sendRawTransaction"]);
  });
  it("rejects wrong-chain signing overrides and replay bytes", async () => {
    chainId = "0x66eee"; unavailable = false; calls.length = 0;
    const runtime = configured();
    await expect(runtime.zkWalletClient.signTransaction({ ...transaction, chainId: 1 })).rejects.toThrow();
    chainId = "0x7a69";
    const foundry = zkNetworkFromEnvironment({ ...local, ZK_RPC_URL: `http://127.0.0.1:${server.port}` })!;
    const raw = await foundry.zkWalletClient.signTransaction(transaction);
    chainId = "0x66eee"; calls.length = 0;
    await expect(runtime.zkPublicClient.sendRawTransaction({ serializedTransaction: raw })).rejects.toThrow();
    expect(calls).not.toContain("eth_sendRawTransaction");
  });
  it("fails closed on unavailable RPC even for fully prepared offline transactions", async () => {
    unavailable = true;
    await expect(configured().zkWalletClient.signTransaction(transaction)).rejects.toThrow("RPC ZK tidak dapat diverifikasi.");
    unavailable = false;
  });
});
