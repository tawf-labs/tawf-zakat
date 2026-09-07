import { describe, expect, it } from "bun:test";
import {
  describeRefusal,
  isSessionUsable,
  sessionStorageKey,
  type StoredSession,
} from "./workspaceSession";

const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  token: "tawf_ws_" + "a".repeat(64),
  institutionId: "lpz-sinar-amanah",
  role: "OFFICER",
  expiresAt: 1_800_003_600,
  ...over,
});

describe("whether a stored session is still worth sending", () => {
  it("accepts one inside its window", () => {
    expect(isSessionUsable(session(), 1_800_000_000)).toBe(true);
  });

  it("refuses one whose window has closed, rather than sending a dead token", () => {
    expect(isSessionUsable(session(), 1_800_003_601)).toBe(false);
  });

  it("treats the closing second as still usable", () => {
    expect(isSessionUsable(session(), 1_800_003_600)).toBe(true);
  });

  it("refuses anything that is not a session at all", () => {
    expect(isSessionUsable(null, 1_800_000_000)).toBe(false);
    expect(isSessionUsable({ ...session(), token: "" }, 1_800_000_000)).toBe(false);
  });
});

describe("where a session is kept", () => {
  it("keys on the API origin and the account, so two accounts never share one", () => {
    const first = sessionStorageKey("https://api.tawf.id", "0xAAA");
    const second = sessionStorageKey("https://api.tawf.id", "0xBBB");
    const otherApi = sessionStorageKey("https://staging.tawf.id", "0xAAA");

    expect(first).not.toBe(second);
    expect(first).not.toBe(otherApi);
  });

  it("keys on the account case-insensitively, because an address is one identity", () => {
    expect(sessionStorageKey("https://api.tawf.id", "0xAbCd")).toBe(
      sessionStorageKey("https://api.tawf.id", "0xABCD")
    );
  });
});

describe("explaining a refusal to the person who hit it", () => {
  it("says what to do about an expired challenge", () => {
    expect(describeRefusal("expired")).toContain("kedaluwarsa");
  });

  it("says plainly that the account is not a member, without naming another institution", () => {
    const message = describeRefusal("no-membership");

    expect(message).toContain("belum terdaftar");
    expect(message).not.toContain("lpz-");
  });

  it("distinguishes a cross-institution refusal from a missing membership", () => {
    expect(describeRefusal("cross-institution")).not.toBe(describeRefusal("no-membership"));
  });

  it("falls back to a plain sentence for a reason it has never seen", () => {
    expect(describeRefusal("sesuatu-yang-baru")).toBeTruthy();
  });
});
