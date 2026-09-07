/**
 * Restricted documents are stored as ciphertext, or not at all (Spec #68, #70).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEncryptedFileStore,
  EvidenceFileError,
  evidenceKeyFromEnv,
  MAX_EVIDENCE_FILE_BYTES,
  sha256Of,
} from "../src/evidence-files";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

const PLAINTEXT = new TextEncoder().encode(
  "nik,nama,rekening\n3201010101010001,Sartika,1234567890\n"
);

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "tawf-evidence-files-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const store = () => createEncryptedFileStore({ directory, key: KEY });

const put = (fileId: string, bytes: Uint8Array = PLAINTEXT) =>
  store().put({ institutionId: "lpz-sinar-amanah", preparationId: "prep-1", fileId, bytes });

describe("the private evidence file store", () => {
  it("returns the plaintext it was given, and its digest", async () => {
    const stored = await put("file-roundtrip");
    expect(stored.contentSha256).toBe(sha256Of(PLAINTEXT));
    expect(stored.sizeBytes).toBe(PLAINTEXT.byteLength);
    expect(await store().get(stored.storageRef)).toEqual(PLAINTEXT);
  });

  it("writes ciphertext, so the identity numbers are not readable off the disk", async () => {
    const stored = await put("file-ciphertext");
    const onDisk = await readFile(stored.storageRef);
    expect(onDisk.includes("3201010101010001")).toBe(false);
    expect(onDisk.includes("Sartika")).toBe(false);
    expect(onDisk).not.toEqual(Buffer.from(PLAINTEXT));
  });

  it("refuses to hand the file back under a different key", async () => {
    const stored = await put("file-wrong-key");
    const otherStore = createEncryptedFileStore({ directory, key: OTHER_KEY });
    expect(otherStore.get(stored.storageRef)).rejects.toThrow();
  });

  it("answers null for a reference nothing was stored under", async () => {
    expect(await store().get(join(directory, "lpz-sinar-amanah", "prep-1", "tidak-ada.bin"))).toBeNull();
  });

  it("refuses a reference that points outside its own directory", async () => {
    expect(await store().get("/etc/passwd")).toBeNull();
  });

  it("refuses an empty file and one past the size ceiling", async () => {
    expect(put("file-empty", new Uint8Array(0))).rejects.toThrow(EvidenceFileError);
    expect(put("file-huge", new Uint8Array(MAX_EVIDENCE_FILE_BYTES + 1))).rejects.toThrow(
      /melebihi batas/
    );
  });

  it("refuses an id that would climb out of the storage root", async () => {
    expect(put("../../escape")).rejects.toThrow(EvidenceFileError);
  });
});

describe("reading the storage key from configuration", () => {
  it("is absent rather than invented when nothing is configured", () => {
    expect(evidenceKeyFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("accepts 32 bytes of hex, with or without the prefix", () => {
    const hex = "ab".repeat(32);
    expect(evidenceKeyFromEnv({ EVIDENCE_FILE_KEY: hex } as any)).toEqual(Buffer.from(hex, "hex"));
    expect(evidenceKeyFromEnv({ EVIDENCE_FILE_KEY: `0x${hex}` } as any)).toEqual(
      Buffer.from(hex, "hex")
    );
  });

  it("refuses a short key rather than stretching it into one", () => {
    expect(() => evidenceKeyFromEnv({ EVIDENCE_FILE_KEY: "rahasia" } as any)).toThrow(
      EvidenceFileError
    );
  });
});
