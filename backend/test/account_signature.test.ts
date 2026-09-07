import { describe, expect, it } from "bun:test";
import { encodeFunctionData, encodeFunctionResult, hashTypedData, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ERC1271_MAGIC_VALUE,
  verifyAccountSignature,
  type EthCall,
} from "../src/account-signature";
import { accessChallenge, WORKSPACE_EIP712_DOMAIN, WORKSPACE_EIP712_TYPES } from "../src/tenancy";

const KEY = `0x${"11".repeat(32)}` as Hex;
const eoa = privateKeyToAccount(KEY);
const CONTRACT_ACCOUNT = "0x00000000000000000000000000000000000c0de5" as const;

const challenge = accessChallenge({
  institutionId: "lpz-sinar-amanah",
  account: eoa.address,
  nonce: `0x${"ab".repeat(32)}`,
  issuedAt: 1_800_000_000,
  ttlSeconds: 300,
});

const typedData = {
  domain: WORKSPACE_EIP712_DOMAIN,
  types: WORKSPACE_EIP712_TYPES,
  primaryType: "WorkspaceAccess" as const,
  message: {
    purpose: challenge.purpose,
    institutionId: challenge.institutionId,
    account: challenge.account,
    nonce: challenge.nonce,
    issuedAt: BigInt(challenge.issuedAt),
    expiresAt: BigInt(challenge.expiresAt),
  },
};

const sign = () => eoa.signTypedData(typedData as never);

/** Stands in for the RPC transport only. The magic-value rule stays ours. */
const returning = (value: Hex): EthCall => async () => value;
const magicReply = encodeFunctionResult({
  abi: parseAbi(["function isValidSignature(bytes32, bytes) view returns (bytes4)"]),
  result: ERC1271_MAGIC_VALUE,
});

const neverCalled: EthCall = async () => {
  throw new Error("The EOA path must not reach the chain.");
};

describe("verifying an EOA signature", () => {
  it("accepts the signature the account actually produced", async () => {
    const result = await verifyAccountSignature({
      typedData,
      account: eoa.address,
      signature: await sign(),
      ethCall: neverCalled,
    });

    expect(result).toEqual({ ok: true, via: "eoa" });
  });

  it("rejects a signature from a different key", async () => {
    const impostor = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);

    const result = await verifyAccountSignature({
      typedData,
      account: eoa.address,
      signature: await impostor.signTypedData(typedData as never),
      ethCall: returning("0x"),
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a signature over a different message", async () => {
    const other = { ...typedData, message: { ...typedData.message, institutionId: "lpz-baitul-maal" } };

    const result = await verifyAccountSignature({
      typedData,
      account: eoa.address,
      signature: await eoa.signTypedData(other as never),
      ethCall: returning("0x"),
    });

    expect(result.ok).toBe(false);
  });

  it("rejects material that is not hex at all, without asking the chain", async () => {
    const result = await verifyAccountSignature({
      typedData,
      account: eoa.address,
      signature: "bukan-tanda-tangan",
      ethCall: neverCalled,
    });

    expect(result).toEqual({ ok: false, reason: "malformed-signature" });
  });
});

describe("the calldata the contract is asked with", () => {
  const abi = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);

  it("matches viem's own encoder at every signature length, padded word or not", async () => {
    // The encoder is written by hand so the digest under judgement is visible
    // in the source. This is what keeps that choice honest.
    const digest = hashTypedData(typedData as never);

    for (const length of [1, 31, 32, 33, 64, 65, 96, 100, 128, 200]) {
      const signature = `0x${"5c".repeat(length)}` as Hex;
      let seen = "";
      await verifyAccountSignature({
        typedData,
        account: CONTRACT_ACCOUNT,
        signature,
        ethCall: async (request) => {
          seen = request.data;
          return "0x";
        },
      });

      expect(seen).toBe(encodeFunctionData({ abi, functionName: "isValidSignature", args: [digest, signature] }));
    }
  });
});

describe("verifying an ERC-1271 contract account", () => {
  it("asks the account itself, over the exact EIP-712 digest", async () => {
    const seen: { to?: string; data?: string } = {};
    const ethCall: EthCall = async (request) => {
      seen.to = request.to;
      seen.data = request.data;
      return magicReply;
    };

    const result = await verifyAccountSignature({
      typedData,
      account: CONTRACT_ACCOUNT,
      signature: await sign(),
      ethCall,
    });

    expect(result).toEqual({ ok: true, via: "erc1271" });
    expect(seen.to).toBe(CONTRACT_ACCOUNT);
    // isValidSignature(bytes32,bytes) selector, then the digest it must judge.
    expect(seen.data?.startsWith("0x1626ba7e")).toBe(true);
    expect(seen.data).toContain(hashTypedData(typedData as never).slice(2));
  });

  it("rejects a wrong magic value rather than reading it as approval", async () => {
    const result = await verifyAccountSignature({
      typedData,
      account: CONTRACT_ACCOUNT,
      signature: await sign(),
      ethCall: returning(
        encodeFunctionResult({
          abi: parseAbi(["function isValidSignature(bytes32, bytes) view returns (bytes4)"]),
          result: "0xffffffff",
        })
      ),
    });

    expect(result).toEqual({ ok: false, reason: "signature-rejected" });
  });

  it("fails closed when the account reverts", async () => {
    const result = await verifyAccountSignature({
      typedData,
      account: CONTRACT_ACCOUNT,
      signature: await sign(),
      ethCall: async () => {
        throw new Error("execution reverted");
      },
    });

    expect(result).toEqual({ ok: false, reason: "signature-rejected" });
  });

  it("fails closed on an empty return, which is what a non-contract answers", async () => {
    const result = await verifyAccountSignature({
      typedData,
      account: CONTRACT_ACCOUNT,
      signature: await sign(),
      ethCall: returning("0x"),
    });

    expect(result.ok).toBe(false);
  });

  it("fails closed when the node is unreachable, never falling back to the EOA path", async () => {
    const result = await verifyAccountSignature({
      typedData,
      account: CONTRACT_ACCOUNT,
      // A signature that is perfectly valid for the EOA, presented for a
      // contract account. The contract's own answer is the only one that counts.
      signature: await sign(),
      ethCall: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
      },
    });

    expect(result.ok).toBe(false);
  });
});
