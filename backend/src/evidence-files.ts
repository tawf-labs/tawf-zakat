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
import { mkdir, readFile, readdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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

export type PrivatePayloadCipher = {
  seal(plaintext: string, binding: string): string;
  open(ciphertext: string, binding: string): string;
};

export type PrivateFileStore = {
  payloads?: PrivatePayloadCipher;
  remove?(storageRef: string): Promise<void>;
  restore?(
    storageRef: string,
    bytes: Uint8Array,
    expected: { contentSha256: string; sizeBytes: number },
  ): Promise<void>;
  put(input: {
    institutionId: string;
    preparationId: string;
    fileId: string;
    bytes: Uint8Array;
    beforeWrite?: (storageRef: string) => Promise<void>;
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

export class EvidenceReadError extends Error {
  constructor(readonly availability: "CORRUPT" | "UNAVAILABLE") { super("Berkas tidak dapat dibaca atau diverifikasi."); }
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

  function encrypt(bytes: Uint8Array, binding = ""): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, options.key, nonce);
    cipher.setAAD(Buffer.from(binding));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  }

  function decrypt(stored: Uint8Array, binding = ""): Buffer {
    if (stored.length < NONCE_BYTES + TAG_BYTES)
      throw new EvidenceReadError("CORRUPT");
    const decipher = createDecipheriv(
      ALGORITHM,
      options.key,
      stored.subarray(0, NONCE_BYTES),
    );
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(stored.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
    try {
      return Buffer.concat([
        decipher.update(stored.subarray(NONCE_BYTES + TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      throw new EvidenceReadError("CORRUPT");
    }
  }

  async function writeEncrypted(target: string, bytes: Uint8Array) {
    const ciphertext = encrypt(bytes);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(ciphertext);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, target);
      const directory = await open(dirname(target), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  return {
    payloads: {
      seal: (plaintext, binding) =>
        encrypt(Buffer.from(plaintext), binding).toString("base64"),
      open: (ciphertext, binding) =>
        decrypt(Buffer.from(ciphertext, "base64"), binding).toString("utf8"),
    },
    async remove(storageRef) {
      if (!resolve(storageRef).startsWith(`${root}/`))
        throw new EvidenceFileError(
          "Lokasi berkas di luar penyimpanan privat.",
        );
      try {
        await unlink(storageRef);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // A crashed writer may never have renamed its ciphertext to the queued target.
      // Match only this target's random temporary siblings, never other source files.
      const prefix = `${basename(storageRef)}.`;
      let entries: string[];
      try {
        entries = await readdir(dirname(storageRef));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const name of entries) {
        if (name.startsWith(prefix) && /^[0-9a-f]{24}\.tmp$/.test(name.slice(prefix.length))) {
          await unlink(join(dirname(storageRef), name)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      }
    },
    async restore(storageRef, bytes, expected) {
      if (
        !resolve(storageRef).startsWith(`${root}/`) ||
        bytes.byteLength !== expected.sizeBytes ||
        bytes.byteLength > MAX_EVIDENCE_FILE_BYTES ||
        sha256Of(bytes) !== expected.contentSha256
      ) {
        throw new EvidenceFileError(
          "Backup tidak cocok dengan berkas yang dikomitmenkan.",
        );
      }
      await writeEncrypted(storageRef, bytes);
    },
    async put({ institutionId, preparationId, fileId, bytes, beforeWrite }) {
      if (bytes.byteLength === 0) {
        throw new EvidenceFileError(
          "Berkas kosong tidak disimpan sebagai bukti.",
        );
      }
      if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
        throw new EvidenceFileError(
          `Berkas ${bytes.byteLength} byte melebihi batas ${MAX_EVIDENCE_FILE_BYTES} byte.`,
        );
      }

      const target = pathFor(institutionId, preparationId, fileId);
      await beforeWrite?.(target);
      await writeEncrypted(target, bytes);

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
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new EvidenceReadError("UNAVAILABLE");
      }
      return new Uint8Array(decrypt(stored));
    },
  };
}
