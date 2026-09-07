/**
 * Where a restricted source document is kept (Spec #68, ticket #70).
 *
 * The files behind a reconciliation are the ones that carry names, national
 * identity numbers and bank details, so this store starts from the position
 * that they are never public and never plaintext:
 *
 * - **Encrypted before it is written.** AES-256-GCM, a fresh 12-byte nonce per
 *   file, the authentication tag kept alongside. What lands on disk - or on any
 *   distribution network a future adapter might hand it to - is ciphertext, and
 *   the key stays in deployment configuration.
 * - **A locator is not an access control.** The reference this returns is an
 *   opaque path, not a capability. Every read goes through an authorization
 *   check first (`routes/evidence.ts`), because a hard-to-guess URL that is
 *   handed out once has been handed out forever.
 * - **Failure is failure.** A write that does not land throws. Nothing here
 *   invents an identifier, a CID or a "stored" status for a file that is not
 *   stored; the caller records the real reason on the file's row instead.
 *
 * No key, no store. Refusing to configure is better than accepting sensitive
 * documents and writing them in the clear.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** 10 MB, matching the audit-document ceiling this project already applies. */
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type StoredFile = {
  /** An opaque locator, private to the deployment. Never returned to a reader. */
  storageRef: string;
  sizeBytes: number;
  /** SHA-256 of the plaintext: what a reader checks a downloaded file against. */
  contentSha256: string;
};

export type PrivateFileStore = {
  put(input: {
    institutionId: string;
    preparationId: string;
    fileId: string;
    bytes: Uint8Array;
  }): Promise<StoredFile>;
  /** The plaintext, or `null` when nothing is stored under that reference. */
  get(storageRef: string): Promise<Uint8Array | null>;
};

/** Thrown when a file cannot be accepted at all; the reason is shown as-is. */
export class EvidenceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceFileError";
  }
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** Path segments come from ids this application mints, and are checked anyway. */
function safeSegment(value: string, what: string): string {
  if (!SEGMENT.test(value)) {
    throw new EvidenceFileError(`${what} tidak sah sebagai nama penyimpanan: ${JSON.stringify(value)}.`);
  }
  return value;
}

export const sha256Of = (bytes: Uint8Array): string =>
  `0x${createHash("sha256").update(Buffer.from(bytes)).digest("hex")}`;

/**
 * Reads the encryption key from deployment configuration.
 *
 * Returns `null` rather than inventing one: a store with a key nobody chose is
 * a store whose ciphertext anyone reading this repository can decrypt.
 */
export function evidenceKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.EVIDENCE_FILE_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new EvidenceFileError(
      "EVIDENCE_FILE_KEY harus 32 byte heksadesimal (64 karakter). Kunci yang lebih pendek tidak " +
        "diterima; dokumen terbatas tidak disimpan tanpa enkripsi."
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * A store that keeps ciphertext on the local filesystem.
 *
 * The pilot keeps restricted documents inside the deployment. If a public
 * distribution network is ever added, it receives exactly the bytes written
 * here - already encrypted - and the key never travels with them.
 */
export function createEncryptedFileStore(options: {
  directory: string;
  key: Buffer;
}): PrivateFileStore {
  if (options.key.length !== 32) {
    throw new EvidenceFileError("Kunci penyimpanan bukti harus 32 byte.");
  }
  const root = resolve(options.directory);

  const pathFor = (institutionId: string, preparationId: string, fileId: string): string =>
    join(
      root,
      safeSegment(institutionId, "Identitas lembaga"),
      safeSegment(preparationId, "Identitas persiapan"),
      `${safeSegment(fileId, "Identitas berkas")}.bin`
    );

  return {
    async put({ institutionId, preparationId, fileId, bytes }) {
      if (bytes.byteLength === 0) {
        throw new EvidenceFileError("Berkas kosong tidak disimpan sebagai bukti.");
      }
      if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
        throw new EvidenceFileError(
          `Berkas ${bytes.byteLength} byte melebihi batas ${MAX_EVIDENCE_FILE_BYTES} byte.`
        );
      }

      const target = pathFor(institutionId, preparationId, fileId);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, options.key, nonce);
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()]);

      await mkdir(dirname(target), { recursive: true });
      // Nonce, tag, then ciphertext. Written in one call so a reader never sees
      // a half-file that would decrypt to nothing and look like corruption.
      await writeFile(target, Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]));

      return {
        storageRef: target,
        sizeBytes: bytes.byteLength,
        contentSha256: sha256Of(bytes),
      };
    },

    async get(storageRef) {
      if (!resolve(storageRef).startsWith(`${root}/`)) return null;

      let stored: Buffer;
      try {
        stored = await readFile(storageRef);
      } catch {
        return null;
      }
      if (stored.length < NONCE_BYTES + TAG_BYTES) return null;

      const nonce = stored.subarray(0, NONCE_BYTES);
      const tag = stored.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
      const ciphertext = stored.subarray(NONCE_BYTES + TAG_BYTES);

      const decipher = createDecipheriv(ALGORITHM, options.key, nonce);
      decipher.setAuthTag(tag);
      // A tag that does not verify throws here, and a file that cannot be
      // authenticated is reported as unavailable rather than returned.
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return new Uint8Array(plaintext);
    },
  };
}
