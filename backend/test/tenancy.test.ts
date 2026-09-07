import { describe, expect, it } from "bun:test";
import {
  accessChallenge,
  authorize,
  capabilitiesFor,
  judgeChallenge,
  resolveTenant,
  WORKSPACE_EIP712_DOMAIN,
  WORKSPACE_EIP712_TYPES,
  WORKSPACE_PURPOSE,
  type AccessChallenge,
  type Membership,
} from "../src/tenancy";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const NONCE = `0x${"ab".repeat(32)}` as const;
const ISSUED_AT = 1_800_000_000;

const challenge = (over: Partial<AccessChallenge> = {}): AccessChallenge => ({
  ...accessChallenge({
    institutionId: "lpz-sinar-amanah",
    account: ACCOUNT,
    nonce: NONCE,
    issuedAt: ISSUED_AT,
    ttlSeconds: 300,
  }),
  ...over,
});

const membership = (over: Partial<Membership> = {}): Membership => ({
  institutionId: "lpz-sinar-amanah",
  account: ACCOUNT,
  role: "OFFICER",
  isActive: true,
  ...over,
});

describe("access challenge", () => {
  it("binds the application purpose, the account and a validity window", () => {
    const issued = challenge();

    expect(issued.purpose).toBe(WORKSPACE_PURPOSE);
    expect(issued.account).toBe(ACCOUNT);
    expect(issued.institutionId).toBe("lpz-sinar-amanah");
    expect(issued.nonce).toBe(NONCE);
    expect(issued.issuedAt).toBe(ISSUED_AT);
    expect(issued.expiresAt).toBe(ISSUED_AT + 300);
  });

  it("lowercases the account so a checksum variant cannot pose as a second identity", () => {
    const mixedCase = accessChallenge({
      institutionId: "lpz-sinar-amanah",
      account: "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd",
      nonce: NONCE,
      issuedAt: ISSUED_AT,
      ttlSeconds: 300,
    });

    expect(mixedCase.account).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });

  it("refuses a window that never closes, so a signature cannot be valid forever", () => {
    expect(() =>
      accessChallenge({
        institutionId: "lpz-sinar-amanah",
        account: ACCOUNT,
        nonce: NONCE,
        issuedAt: ISSUED_AT,
        ttlSeconds: 0,
      })
    ).toThrow();
  });

  it("signs under its own domain, never the vault governance domain", () => {
    expect(WORKSPACE_EIP712_DOMAIN.name).toBe("Tawf Workspace Access");
    // The vault domain names a verifying contract; workspace access is offchain
    // and must not be replayable as a governance action on that contract.
    expect("verifyingContract" in WORKSPACE_EIP712_DOMAIN).toBe(false);
    expect(WORKSPACE_EIP712_TYPES.WorkspaceAccess.map((field) => field.name)).toEqual([
      "purpose",
      "institutionId",
      "account",
      "nonce",
      "issuedAt",
      "expiresAt",
    ]);
  });
});

describe("judging a challenge", () => {
  it("accepts an unused challenge inside its window", () => {
    expect(judgeChallenge(challenge(), ISSUED_AT + 10)).toEqual({ ok: true });
  });

  it("rejects a challenge presented after it expired", () => {
    const verdict = judgeChallenge(challenge(), ISSUED_AT + 301);

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("expired");
  });

  // Single use is not judged here: it cannot be decided atomically by a pure
  // function, so it lives in the store's conditional UPDATE and is tested there.

  it("rejects a challenge presented before it was issued", () => {
    const verdict = judgeChallenge(challenge(), ISSUED_AT - 1);

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("not-yet-valid");
  });

  it("treats the closing instant as still valid and the next second as gone", () => {
    expect(judgeChallenge(challenge(), ISSUED_AT + 300).ok).toBe(true);
    expect(judgeChallenge(challenge(), ISSUED_AT + 301).ok).toBe(false);
  });
});

describe("resolving the tenant", () => {
  it("takes the institution from the membership, never from the request", () => {
    const access = resolveTenant(membership(), { requestedInstitutionId: undefined });

    expect(access.ok).toBe(true);
    expect(access.ok === true && access.institutionId).toBe("lpz-sinar-amanah");
  });

  it("rejects a request naming another institution rather than quietly reassigning it", () => {
    const access = resolveTenant(membership(), { requestedInstitutionId: "lpz-baitul-maal" });

    expect(access.ok).toBe(false);
    expect(access.ok === false && access.reason).toBe("cross-institution");
  });

  it("accepts a request that names its own institution", () => {
    const access = resolveTenant(membership(), { requestedInstitutionId: "lpz-sinar-amanah" });

    expect(access.ok).toBe(true);
  });

  it("rejects a membership that has been deactivated", () => {
    const access = resolveTenant(membership({ isActive: false }), { requestedInstitutionId: undefined });

    expect(access.ok).toBe(false);
    expect(access.ok === false && access.reason).toBe("membership-inactive");
  });

  it("rejects an account with no membership at all", () => {
    const access = resolveTenant(null, { requestedInstitutionId: undefined });

    expect(access.ok).toBe(false);
    expect(access.ok === false && access.reason).toBe("no-membership");
  });
});

describe("capabilities", () => {
  it("lets a reader read and nothing else", () => {
    expect(capabilitiesFor("READER")).toEqual({
      viewWorkspace: true,
      prepareEvidence: false,
      manageMembers: false,
    });
  });

  it("lets an officer prepare evidence but not manage the institution", () => {
    expect(capabilitiesFor("OFFICER")).toEqual({
      viewWorkspace: true,
      prepareEvidence: true,
      manageMembers: false,
    });
  });

  it("lets an administrator manage members", () => {
    expect(capabilitiesFor("ADMIN")).toEqual({
      viewWorkspace: true,
      prepareEvidence: true,
      manageMembers: true,
    });
  });

  it("refuses a reader the write capability at the authorization gate", () => {
    expect(authorize("READER", "prepareEvidence")).toBe(false);
    expect(authorize("OFFICER", "prepareEvidence")).toBe(true);
    expect(authorize("OFFICER", "manageMembers")).toBe(false);
    expect(authorize("ADMIN", "manageMembers")).toBe(true);
  });

  it("grants nothing that offchain membership has no business granting", () => {
    // Workspace membership governs the workspace. Recording and publishing are
    // the registry's to check, so no capability here may stand in for a role.
    for (const role of ["ADMIN", "OFFICER", "READER"] as const) {
      expect(Object.keys(capabilitiesFor(role))).toEqual([
        "viewWorkspace",
        "prepareEvidence",
        "manageMembers",
      ]);
    }
  });
});
