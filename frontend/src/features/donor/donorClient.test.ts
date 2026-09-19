import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearDonorSession, endDonorSession, fetchDonorContribution, readDonorSession, saveDonorSession, DonorSessionEndedError } from "./donorClient";

const store = new Map<string, string>();
const realFetch = globalThis.fetch;
const realWindow = globalThis.window;
let requests: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  store.clear();
  requests = [];
  (globalThis as any).window = {
    location: { hostname: "localhost", port: "3000" },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as any).window = realWindow;
});

const respond = (status: number, body: unknown) => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
};

const SESSION = { token: "dsess_abc", contributionId: "contrib-1", expiresAt: 2_000 };

describe("Donor client (Ticket #104, Spec #100)", () => {
  it("keeps a session per reference and forgets it once expired", () => {
    saveDonorSession("BCA-1", SESSION);
    expect(readDonorSession("BCA-1", 1_999)).toEqual(SESSION);
    expect(readDonorSession("BCA-2", 1_999)).toBeNull();

    expect(readDonorSession("BCA-1", 2_000)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("forgets a session on request", () => {
    saveDonorSession("BCA-1", SESSION);
    clearDonorSession("BCA-1");
    expect(readDonorSession("BCA-1", 1_000)).toBeNull();
  });

  it("sends the token only in the Authorization header, never in the URL", async () => {
    respond(200, { contribution: { id: "contrib-1" } });
    await fetchDonorContribution(SESSION);
    expect(requests[0].url).not.toContain(SESSION.token);
    expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION.token}`);
  });

  it("reports a refused session as ended, distinct from other failures", async () => {
    respond(401, { error: "Sesi akses donatur telah kedaluwarsa." });
    await expect(fetchDonorContribution(SESSION)).rejects.toBeInstanceOf(DonorSessionEndedError);

    respond(500, { error: "gagal" });
    const failure = await fetchDonorContribution(SESSION).catch((error) => error);
    expect(failure).not.toBeInstanceOf(DonorSessionEndedError);
  });

  it("revokes the session with DELETE", async () => {
    respond(200, { success: true });
    await endDonorSession(SESSION.token);
    expect(requests[0].url).toEndWith("/api/donor/session");
    expect(requests[0].init?.method).toBe("DELETE");
  });
});
