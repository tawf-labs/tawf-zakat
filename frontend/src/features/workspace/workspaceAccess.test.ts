import { describe, expect, it } from "bun:test";
import { openWorkspaceSession, type AccessPorts } from "./workspaceAccess";

const CHALLENGE = {
  challenge: { nonce: "0xab".padEnd(66, "c"), institutionId: "lpz-sinar-amanah", account: "0x1", issuedAt: 1, expiresAt: 301 },
  typedData: {
    domain: { name: "Tawf Workspace Access", version: "1" },
    types: { WorkspaceAccess: [{ name: "issuedAt", type: "uint256" }] },
    primaryType: "WorkspaceAccess",
    message: { purpose: "Masuk ruang kerja lembaga", issuedAt: 1, expiresAt: 301 },
  },
};

const OPENED = { token: "tawf_ws_abc", expiresAt: 3601, institutionId: "lpz-sinar-amanah", role: "OFFICER" as const };

const ports = (over: Partial<AccessPorts> = {}): AccessPorts => ({
  requestChallenge: async () => CHALLENGE as never,
  sign: async () => "0xsig",
  exchange: async () => OPENED,
  ...over,
});

describe("opening a workspace session", () => {
  it("walks challenge, signature and exchange in that order", async () => {
    const calls: string[] = [];
    const result = await openWorkspaceSession(
      ports({
        requestChallenge: async () => {
          calls.push("challenge");
          return CHALLENGE as never;
        },
        sign: async () => {
          calls.push("sign");
          return "0xsig";
        },
        exchange: async () => {
          calls.push("exchange");
          return OPENED;
        },
      }),
      { institutionId: "lpz-sinar-amanah", account: "0xabc" }
    );

    expect(calls).toEqual(["challenge", "sign", "exchange"]);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.session.token).toBe("tawf_ws_abc");
  });

  it("hands the wallet the numeric fields as bigint, or the digest would differ", async () => {
    let signed: any = null;
    await openWorkspaceSession(
      ports({
        sign: async (payload) => {
          signed = payload;
          return "0xsig";
        },
      }),
      { institutionId: "lpz-sinar-amanah", account: "0xabc" }
    );

    expect(typeof signed.message.issuedAt).toBe("bigint");
    expect(typeof signed.message.expiresAt).toBe("bigint");
    expect(signed.message.issuedAt).toBe(1n);
    // Everything else is passed through exactly as the server described it.
    expect(signed.message.purpose).toBe("Masuk ruang kerja lembaga");
    expect(signed.domain).toEqual(CHALLENGE.typedData.domain);
    expect(signed.primaryType).toBe("WorkspaceAccess");
  });

  it("sends back the nonce the server minted, never one it made up", async () => {
    let sentNonce = "";
    await openWorkspaceSession(
      ports({
        exchange: async (nonce) => {
          sentNonce = nonce;
          return OPENED;
        },
      }),
      { institutionId: "lpz-sinar-amanah", account: "0xabc" }
    );

    expect(sentNonce).toBe(CHALLENGE.challenge.nonce);
  });

  it("reports a refused challenge without asking the wallet to sign", async () => {
    let signCalled = false;
    const result = await openWorkspaceSession(
      ports({
        requestChallenge: async () => {
          throw new Error("Lembaga tidak dikenal.");
        },
        sign: async () => {
          signCalled = true;
          return "0xsig";
        },
      }),
      { institutionId: "lpz-tidak-ada", account: "0xabc" }
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("Lembaga tidak dikenal.");
    expect(signCalled).toBe(false);
  });

  it("reports a wallet refusal as a refusal, not a crash", async () => {
    const result = await openWorkspaceSession(
      ports({
        sign: async () => {
          throw new Error("User rejected the request.");
        },
      }),
      { institutionId: "lpz-sinar-amanah", account: "0xabc" }
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("rejected");
  });

  it("reports the server's own words when the exchange is refused", async () => {
    const result = await openWorkspaceSession(
      ports({
        exchange: async () => {
          throw new Error("Akun wallet ini belum terdaftar pada ruang kerja lembaga.");
        },
      }),
      { institutionId: "lpz-sinar-amanah", account: "0xabc" }
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("belum terdaftar");
  });

  it("keeps the institution and role the server decided, not the one asked for", async () => {
    const result = await openWorkspaceSession(
      ports({
        exchange: async () => ({ ...OPENED, institutionId: "lpz-baitul-maal", role: "READER" as const }),
      }),
      { institutionId: "lpz-sinar-amanah", account: "0xabc" }
    );

    expect(result.ok === true && result.session.institutionId).toBe("lpz-baitul-maal");
    expect(result.ok === true && result.session.role).toBe("READER");
  });
});
