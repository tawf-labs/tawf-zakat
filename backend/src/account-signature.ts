/**
 * Proving that an account signed something (Spec #68, ticket #69).
 *
 * Two kinds of account can hold institutional authority, and they answer the
 * question differently. An EOA is proved by recovering the signer from the
 * signature - arithmetic, done here, offline. A contract account cannot be
 * recovered from: only the contract knows its own signing rules, so ERC-1271
 * asks it, and the answer is a four-byte magic value.
 *
 * The seam sits at `EthCall`, and only there. The digest, the calldata, the
 * magic-value comparison and every failure rule are this module's own and run
 * for real in tests; what a test may substitute is the transport that carries
 * one `eth_call` to a node, because a node is neither deterministic nor local.
 *
 * Everything fails closed. A revert, an empty return, an unreachable node, a
 * wrong magic value: all of them are "not proved". In particular an unreachable
 * node never falls back to the EOA path - an account that declared itself a
 * contract is judged by the contract, or not at all.
 */

import { hashTypedData, isHex, verifyTypedData, type Hex } from "viem";

/** `bytes4(keccak256("isValidSignature(bytes32,bytes)"))`, per ERC-1271. */
export const ERC1271_MAGIC_VALUE = "0x1626ba7e" as const;

/** The one seam: a single `eth_call`, returning raw return data. */
export type EthCall = (request: { to: string; data: Hex }) => Promise<string>;

export type TypedDataRequest = {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type SignatureVerdict =
  | { ok: true; via: "eoa" | "erc1271" }
  | { ok: false; reason: "malformed-signature" | "signature-rejected" };

const REJECTED = { ok: false, reason: "signature-rejected" } as const;

/**
 * Encodes `isValidSignature(bytes32,bytes)` by hand rather than through an ABI
 * helper, so the digest under judgement is visibly the one we computed.
 */
function encodeIsValidSignature(digest: Hex, signature: Hex): Hex {
  const body = signature.slice(2);
  const byteLength = body.length / 2;
  const padded = body.padEnd(Math.ceil(byteLength / 32) * 64, "0");
  return [
    ERC1271_MAGIC_VALUE,
    digest.slice(2),
    // Offset to the `bytes` argument: two head words.
    (64).toString(16).padStart(64, "0"),
    byteLength.toString(16).padStart(64, "0"),
    padded,
  ].join("") as Hex;
}

/**
 * Verifies that `account` signed `typedData`.
 *
 * The EOA path is tried first because it needs no network. Failing it is not a
 * verdict on its own - the account may be a contract - so the ERC-1271 path
 * follows, and its answer is final.
 */
export async function verifyAccountSignature(input: {
  typedData: TypedDataRequest;
  account: string;
  signature: string;
  ethCall: EthCall;
}): Promise<SignatureVerdict> {
  const { typedData, ethCall } = input;

  if (!isHex(input.signature) || input.signature.length < 4) {
    return { ok: false, reason: "malformed-signature" };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.account)) {
    return { ok: false, reason: "malformed-signature" };
  }
  const signature = input.signature as Hex;

  try {
    const recovered = await verifyTypedData({
      ...typedData,
      address: input.account as Hex,
      signature,
    } as Parameters<typeof verifyTypedData>[0]);
    if (recovered) return { ok: true, via: "eoa" };
  } catch {
    // Not recoverable as an EOA signature; the contract may still own it.
  }

  const digest = hashTypedData(typedData as never);

  let returned: string;
  try {
    returned = await ethCall({ to: input.account, data: encodeIsValidSignature(digest, signature) });
  } catch {
    // Revert, unreachable node, malformed response: none of them is a proof.
    return REJECTED;
  }

  if (!isHex(returned) || returned.length < 10) return REJECTED;
  // A `bytes4` return is left-aligned in its 32-byte word.
  return returned.slice(0, 10).toLowerCase() === ERC1271_MAGIC_VALUE ? { ok: true, via: "erc1271" } : REJECTED;
}
