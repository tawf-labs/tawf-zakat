/**
 * The sign-in walk, with the wallet held at arm's length (Spec #68, ticket #69).
 *
 * Challenge, signature, exchange - in that order, and the order matters: the
 * wallet is only asked to sign something the server minted, and the nonce sent
 * back is the one that came with it. A client that made up its own nonce would
 * be proving nothing to anybody.
 *
 * Every outside thing it touches arrives as a port, so the whole flow can be
 * exercised - including a refused challenge, a wallet the person dismissed, and
 * a server that says no - without a browser, a wallet or a running API, and
 * without adding a React testing framework this ticket has no other use for.
 *
 * It decides nothing about authority. The institution and role in the result
 * are whatever the server returned, never what the caller asked for; the caller
 * naming an institution only says which challenge to mint.
 */

import type { AccessChallengeResponse } from "./workspaceClient";
import type { StoredSession, WorkspaceRole } from "./workspaceSession";

export type SigningPayload = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type AccessPorts = {
  requestChallenge: (institutionId: string, account: string) => Promise<AccessChallengeResponse>;
  sign: (payload: SigningPayload) => Promise<string>;
  exchange: (
    nonce: string,
    signature: string
  ) => Promise<{ token: string; expiresAt: number; institutionId: string; role: WorkspaceRole }>;
};

export type AccessResult =
  | { ok: true; session: StoredSession }
  | { ok: false; error: string };

export async function openWorkspaceSession(
  ports: AccessPorts,
  request: { institutionId: string; account: string }
): Promise<AccessResult> {
  try {
    const { challenge, typedData } = await ports.requestChallenge(request.institutionId, request.account);

    // `uint256` fields cross the wire as JSON numbers and must become `bigint`
    // before the digest is computed, or the wallet signs a different message
    // than the server will verify.
    const signature = await ports.sign({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: {
        ...typedData.message,
        issuedAt: BigInt(typedData.message.issuedAt),
        expiresAt: BigInt(typedData.message.expiresAt),
      },
    });

    const opened = await ports.exchange(challenge.nonce, signature);

    return {
      ok: true,
      session: {
        token: opened.token,
        institutionId: opened.institutionId,
        role: opened.role,
        expiresAt: opened.expiresAt,
      },
    };
  } catch (caught: unknown) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Gagal masuk ke ruang kerja." };
  }
}
