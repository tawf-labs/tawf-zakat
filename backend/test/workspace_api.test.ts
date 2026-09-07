import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { encodeFunctionResult, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { ERC1271_MAGIC_VALUE, type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const officer = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const outsider = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
const rivalOfficer = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);
/** Signs for the contract account; the contract's answer is what decides. */
const contractSigner = privateKeyToAccount(`0x${"55".repeat(32)}` as Hex);
const CONTRACT_ACCOUNT = "0x00000000000000000000000000000000000c0de5";

const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let clock = NOW;
let contractApproves = true;

const magic = (value: Hex) =>
  encodeFunctionResult({
    abi: parseAbi(["function isValidSignature(bytes32, bytes) view returns (bytes4)"]),
    result: value,
  });

/**
 * Only the RPC transport is substituted; the ERC-1271 rule runs for real.
 *
 * It answers the way a node does: an address with no code returns empty data,
 * so an EOA can never be admitted through the contract path. Making this stub
 * approve every address would have let any signature in, which is exactly the
 * hole the test below about somebody else's challenge is there to catch.
 */
const ethCall: EthCall = async ({ to }) => {
  if (to.toLowerCase() !== CONTRACT_ACCOUNT.toLowerCase()) return "0x";
  return contractApproves ? magic(ERC1271_MAGIC_VALUE) : magic("0xffffffff");
};

const request = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${BASE}${path}`, init));

const post = (path: string, body: unknown, token?: string) =>
  request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (path: string, token?: string) =>
  request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

/** Walks the whole door: mint a challenge, sign it, exchange it for a session. */
async function signIn(
  account: { address: string; signTypedData: (payload: any) => Promise<Hex> },
  institutionId: string
): Promise<Response> {
  const minted = await post("/challenge", { institutionId, account: account.address });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
  return post("/session", { nonce: challenge.nonce, signature });
}

const tokenFrom = async (response: Response): Promise<string> => {
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(typeof body.token).toBe("string");
  return body.token;
};

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  store = createWorkspaceStore(database.handle());
  await store.ensureSchema();
});

afterAll(async () => {
  resetWorkspace();
  await database.close();
});

beforeEach(async () => {
  clock = NOW;
  contractApproves = true;
  await database.reset();

  for (const institution of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(institution));
  }
  await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: reader.address, role: "READER" });
  await store.upsertMembership({ institutionId: BAITUL, account: rivalOfficer.address, role: "ADMIN" });
  await store.upsertMembership({ institutionId: SINAR, account: CONTRACT_ACCOUNT, role: "ADMIN" });

  configureWorkspace({
    store,
    ethCall,
    now: () => clock,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600,
  });
});

describe("the two synthetic institutions", () => {
  it("ships exactly two, both labelled synthetic", () => {
    expect(SYNTHETIC_INSTITUTIONS).toHaveLength(2);
    for (const institution of SYNTHETIC_INSTITUTIONS) {
      expect(institution.isSynthetic).toBe(true);
      expect(institution.mandateNote.toLowerCase()).toContain("sintetis");
    }
  });

  it("carries the accounts onboarding installs, so a local sign-in is possible", () => {
    // Without an initial administrator there is no way to reach POST /members,
    // and without an officer there is nobody to open a workspace at all.
    for (const institution of SYNTHETIC_INSTITUTIONS) {
      const roles = institution.members.map((member) => member.role);
      expect(roles).toContain("ADMIN");
      expect(roles).toContain("OFFICER");
      for (const member of institution.members) {
        expect(member.account).toMatch(/^0x[0-9a-f]{40}$/);
      }
    }
  });

  it("gives no account authority in two institutions at once", () => {
    const accounts = SYNTHETIC_INSTITUTIONS.flatMap((i) => i.members.map((m) => m.account));
    expect(new Set(accounts).size).toBe(accounts.length);
  });
});

describe("advertising institutions", () => {
  it("lists what onboarding actually installed, not a hardcoded fixture list", async () => {
    const listed = await (await get("/institutions")).json();
    expect(listed.institutions.map((i: any) => i.id).sort()).toEqual([BAITUL, SINAR]);

    // Every advertised id must be one a challenge can actually be minted for.
    for (const institution of listed.institutions) {
      const minted = await post("/challenge", { institutionId: institution.id, account: officer.address });
      expect(minted.status).toBe(201);
    }
  });
});

describe("minting a challenge", () => {
  it("returns a nonce, a closing time and the payload to sign", async () => {
    const response = await post("/challenge", { institutionId: SINAR, account: officer.address });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.challenge.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.challenge.expiresAt).toBe(NOW + 300);
    expect(body.typedData.primaryType).toBe("WorkspaceAccess");
    expect(body.typedData.domain.name).toBe("Tawf Workspace Access");
    // Offchain access must not be replayable against the vault contract.
    expect(body.typedData.domain.verifyingContract).toBeUndefined();
  });

  it("mints a different nonce every time", async () => {
    const first = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();
    const second = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();

    expect(first.challenge.nonce).not.toBe(second.challenge.nonce);
  });

  it("refuses an institution nobody onboarded", async () => {
    const response = await post("/challenge", { institutionId: "lpz-tidak-ada", account: officer.address });

    expect(response.status).toBe(404);
  });

  it("refuses a malformed account rather than minting for it", async () => {
    const response = await post("/challenge", { institutionId: SINAR, account: "bukan-alamat" });

    expect(response.status).toBe(400);
  });
});

describe("opening a session", () => {
  it("lets an onboarded officer in and names the institution they act for", async () => {
    const token = await tokenFrom(await signIn(officer, SINAR));
    const response = await get("", token);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.institution.id).toBe(SINAR);
    expect(body.institution.legalName).toContain("Sinar Amanah");
    expect(body.account).toBe(officer.address.toLowerCase());
    expect(body.role).toBe("OFFICER");
    expect(body.capabilities).toEqual({
      viewWorkspace: true,
      prepareEvidence: true,
      manageMembers: false,
    });
  });

  it("says plainly that the workspace holds no evidence yet, rather than adopting old data", async () => {
    const token = await tokenFrom(await signIn(officer, SINAR));
    const body = await (await get("", token)).json();

    expect(body.institution.isSynthetic).toBe(true);
    // Evidence packages arrived with #70. This runtime configures no evidence
    // store, so the list is empty - and empty is the honest answer: the
    // donations recorded before institutions existed are adopted by nobody.
    expect(body.evidencePackages).toEqual([]);
  });

  it("refuses an account nobody onboarded", async () => {
    const response = await signIn(outsider, SINAR);

    expect(response.status).toBe(403);
    expect((await response.json()).reason).toBe("no-membership");
  });

  it("refuses a signature that is valid but over somebody else's challenge", async () => {
    const minted = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();
    const stolen = await (await post("/challenge", { institutionId: BAITUL, account: rivalOfficer.address })).json();
    const signature = await officer.signTypedData({
      ...stolen.typedData,
      message: {
        ...stolen.typedData.message,
        issuedAt: BigInt(stolen.typedData.message.issuedAt),
        expiresAt: BigInt(stolen.typedData.message.expiresAt),
      },
    });

    const response = await post("/session", { nonce: minted.challenge.nonce, signature });

    expect(response.status).toBe(401);
  });

  it("refuses an address asserted with no signature at all", async () => {
    const minted = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();

    const response = await post("/session", { nonce: minted.challenge.nonce, account: officer.address });

    expect(response.status).toBe(400);
  });

  it("spends the challenge, so replaying the very same request buys nothing", async () => {
    const minted = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();
    const signature = await officer.signTypedData({
      ...minted.typedData,
      message: {
        ...minted.typedData.message,
        issuedAt: BigInt(minted.typedData.message.issuedAt),
        expiresAt: BigInt(minted.typedData.message.expiresAt),
      },
    });

    expect((await post("/session", { nonce: minted.challenge.nonce, signature })).status).toBe(201);

    const replay = await post("/session", { nonce: minted.challenge.nonce, signature });
    expect(replay.status).toBe(401);
    expect((await replay.json()).reason).toBe("replayed");
  });

  it("refuses a challenge presented after its window closed", async () => {
    const minted = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();
    const signature = await officer.signTypedData({
      ...minted.typedData,
      message: {
        ...minted.typedData.message,
        issuedAt: BigInt(minted.typedData.message.issuedAt),
        expiresAt: BigInt(minted.typedData.message.expiresAt),
      },
    });

    clock = NOW + 301;
    const response = await post("/session", { nonce: minted.challenge.nonce, signature });

    expect(response.status).toBe(401);
    expect((await response.json()).reason).toBe("expired");
  });

  it("does not burn the challenge when the signature is wrong, so a stranger cannot lock an officer out", async () => {
    const minted = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();

    // Someone who learned the nonce spends it on garbage.
    const attacked = await post("/session", { nonce: minted.challenge.nonce, signature: `0x${"00".repeat(65)}` });
    expect(attacked.status).toBe(401);

    // The officer's own challenge is still theirs to use.
    const signature = await officer.signTypedData({
      ...minted.typedData,
      message: {
        ...minted.typedData.message,
        issuedAt: BigInt(minted.typedData.message.issuedAt),
        expiresAt: BigInt(minted.typedData.message.expiresAt),
      },
    });
    expect((await post("/session", { nonce: minted.challenge.nonce, signature })).status).toBe(201);
  });

  it("refuses a stored challenge whose purpose is not workspace access", async () => {
    const minted = await (await post("/challenge", { institutionId: SINAR, account: officer.address })).json();
    // A row that some other flow wrote must not open a workspace session, even
    // with a signature the account genuinely produced.
    await database.setChallengePurpose(minted.challenge.nonce, "Tujuan lain");
    const signature = await officer.signTypedData({
      ...minted.typedData,
      message: {
        ...minted.typedData.message,
        issuedAt: BigInt(minted.typedData.message.issuedAt),
        expiresAt: BigInt(minted.typedData.message.expiresAt),
      },
    });

    const response = await post("/session", { nonce: minted.challenge.nonce, signature });

    expect(response.status).toBe(401);
    expect((await response.json()).reason).toBe("unknown-challenge");
  });

  it("refuses an unknown nonce", async () => {
    const response = await post("/session", { nonce: `0x${"cd".repeat(32)}`, signature: `0x${"00".repeat(65)}` });

    expect(response.status).toBe(401);
  });
});

describe("contract accounts", () => {
  it("admits an ERC-1271 account when the contract itself approves", async () => {
    const minted = await (await post("/challenge", { institutionId: SINAR, account: CONTRACT_ACCOUNT })).json();
    const signature = await contractSigner.signTypedData({
      ...minted.typedData,
      message: {
        ...minted.typedData.message,
        issuedAt: BigInt(minted.typedData.message.issuedAt),
        expiresAt: BigInt(minted.typedData.message.expiresAt),
      },
    });

    const token = await tokenFrom(await post("/session", { nonce: minted.challenge.nonce, signature }));
    expect((await (await get("", token)).json()).account).toBe(CONTRACT_ACCOUNT);
  });

  it("refuses when the contract declines, and does not fall back to recovery", async () => {
    contractApproves = false;
    const minted = await (await post("/challenge", { institutionId: SINAR, account: CONTRACT_ACCOUNT })).json();
    const signature = await contractSigner.signTypedData({
      ...minted.typedData,
      message: {
        ...minted.typedData.message,
        issuedAt: BigInt(minted.typedData.message.issuedAt),
        expiresAt: BigInt(minted.typedData.message.expiresAt),
      },
    });

    const response = await post("/session", { nonce: minted.challenge.nonce, signature });

    expect(response.status).toBe(401);
  });
});

describe("carrying a session", () => {
  it("refuses a request with no credential at the API, not merely in the UI", async () => {
    expect((await get("")).status).toBe(401);
  });

  it("refuses a token nobody issued", async () => {
    expect((await get("", "tawf_ws_" + "f".repeat(64))).status).toBe(401);
  });

  it("stops working once the session has run out", async () => {
    const token = await tokenFrom(await signIn(officer, SINAR));

    clock = NOW + 3600;
    expect((await get("", token)).status).toBe(200);

    clock = NOW + 3601;
    expect((await get("", token)).status).toBe(401);
  });

  it("stops working the moment the officer signs out", async () => {
    const token = await tokenFrom(await signIn(officer, SINAR));

    const out = await request("/session", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(out.status).toBe(204);

    expect((await get("", token)).status).toBe(401);
  });
});

describe("staying inside one institution", () => {
  it("refuses a read that names another institution rather than serving it", async () => {
    const token = await tokenFrom(await signIn(officer, SINAR));

    const response = await get(`?institutionId=${BAITUL}`, token);

    expect(response.status).toBe(403);
    expect((await response.json()).reason).toBe("cross-institution");
  });

  it("takes the owner from the session, so editing the payload moves nothing", async () => {
    const adminToken = await tokenFrom(await signIn(rivalOfficer, BAITUL));

    const response = await post(
      "/members",
      { institutionId: SINAR, account: outsider.address, role: "READER" },
      adminToken
    );

    expect(response.status).toBe(403);
    // The rival's institution gained nobody, and neither did the target's.
    expect((await store.membersOf(SINAR)).length).toBe(3);
    expect((await store.membersOf(BAITUL)).length).toBe(1);
  });

  it("records a new member under the session's own institution", async () => {
    const adminToken = await tokenFrom(await signIn(rivalOfficer, BAITUL));

    const response = await post("/members", { account: outsider.address, role: "READER" }, adminToken);

    expect(response.status).toBe(201);
    expect((await store.membersOf(BAITUL)).length).toBe(2);
    expect((await store.activeMembershipFor(outsider.address))?.institutionId).toBe(BAITUL);
  });

  it("refuses a challenge minted for one institution and an account belonging to another", async () => {
    const response = await signIn(officer, BAITUL);

    expect(response.status).toBe(403);
    expect((await response.json()).reason).toBe("cross-institution");
  });
});

describe("what a reader may not do", () => {
  it("lets a reader read", async () => {
    const token = await tokenFrom(await signIn(reader, SINAR));
    const body = await (await get("", token)).json();

    expect(body.role).toBe("READER");
    expect(body.capabilities).toEqual({
      viewWorkspace: true,
      prepareEvidence: false,
      manageMembers: false,
    });
  });

  it("refuses a reader the power to change anything", async () => {
    const token = await tokenFrom(await signIn(reader, SINAR));

    const response = await post("/members", { account: outsider.address, role: "READER" }, token);

    expect(response.status).toBe(403);
    expect(await store.activeMembershipFor(outsider.address)).toBeNull();
  });

  it("refuses even an administrator the power to mint another administrator", async () => {
    const adminToken = await tokenFrom(await signIn(rivalOfficer, BAITUL));

    const response = await post("/members", { account: outsider.address, role: "ADMIN" }, adminToken);

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("onboarding");
    expect(await store.activeMembershipFor(outsider.address)).toBeNull();
  });

  it("refuses an officer the powers reserved to an administrator", async () => {
    const token = await tokenFrom(await signIn(officer, SINAR));

    const response = await post("/members", { account: outsider.address, role: "READER" }, token);

    expect(response.status).toBe(403);
  });
});

describe("what the workspace never says out loud", () => {
  it("returns the bearer token once, at sign-in, and never again", async () => {
    const token = await tokenFrom(await signIn(officer, SINAR));

    const body = await (await get("", token)).text();

    expect(body).not.toContain(token);
    expect(body.toLowerCase()).not.toContain("token");
    expect(body.toLowerCase()).not.toContain("signature");
  });

  it("does not leak whether a rejected account is a member of some other institution", async () => {
    const outsiderReason = (await (await signIn(outsider, SINAR)).json()).reason;
    const rivalReason = (await (await signIn(rivalOfficer, SINAR)).json()).reason;

    // Both are refused; neither answer names the institution the caller is not in.
    expect(JSON.stringify(rivalReason)).not.toContain(BAITUL);
    expect(outsiderReason).toBe("no-membership");
  });
});
