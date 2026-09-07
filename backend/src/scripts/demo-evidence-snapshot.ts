/**
 * The snapshot demonstration, end to end (Spec #68, ticket #70).
 *
 *   bun src/scripts/demo-evidence-snapshot.ts
 *
 * Two ledgers with a gap of exactly Rp300.000.000, frozen and reconciled. Then
 * the working input changes - the same two Pengelola Zakat, corrected numbers -
 * and the first snapshot is reopened. It still answers with the figures it was
 * examined against, which is the whole claim of this ticket.
 *
 * It runs against its own throwaway PostgreSQL (PGlite) in a temp directory and
 * its own file store, so it needs no `DATABASE_URL`, touches no deployment, and
 * leaves nothing behind. Every request below goes through the real HTTP app -
 * the same routes, gates and engine a browser would reach.
 *
 * The accounts are the published Anvil test keys the fixtures already use. They
 * are worthless as credentials, which is exactly what a demo account should be.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
// Set before loading the app: Bun may have loaded a deployment .env, but this
// demonstration must never install its database or indexer adapters.
process.env.NODE_ENV = "test";
const { default: app } = await import("../index");
import { createWorkspaceStore } from "../tenancy-store";
import { createEvidenceStore } from "../evidence-store";
import { createEncryptedFileStore } from "../evidence-files";
import { configureWorkspace, resetWorkspace } from "../workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../fixtures/institutions";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";
const SINAR = "lpz-sinar-amanah";

/** Anvil account #1, published in every Ethereum toolchain. Not a credential. */
const OFFICER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const say = (line = "") => console.log(line);
const heading = (line: string) => say(`\n\x1b[1m${line}\x1b[0m`);

const manifest = (role: "CLAIM" | "SOURCE") => ({
  label: role === "CLAIM" ? "Rekap Laporan Zakat Wilayah Riau" : "12 Laporan Kinerja Kab/Kota",
  origin: role === "CLAIM" ? "PASTE" : "UPLOAD",
  scopeUnit: "Provinsi Riau",
  scopeLevel: "PROVINSI",
  fundTypes: ["ZAKAT"],
  balanceSheet: "ON",
  currencyUnit: "IDR",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  cutOff: "2025-02-11T00:00:00.000Z",
  format: "baris-ledger",
  mappingVersion: "1",
  transactionDetail: "PRESENT",
});

const row = (key: string, amount: string, label: string) => ({
  key,
  bucket: "ZAKAT",
  balanceSheet: "ON",
  value: { amount, unit: "IDR" },
  label,
});

const rupiah = (amount: string): string =>
  `Rp${amount.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "tawf-demo-"));
  const fileDirectory = await mkdtemp(join(tmpdir(), "tawf-demo-files-"));
  const client = new PGlite(directory);
  const db = drizzle(client);

  const store = createWorkspaceStore(db);
  const evidence = createEvidenceStore(db);
  await store.ensureSchema();
  await evidence.ensureSchema();

  configureWorkspace({
    store,
    evidence,
    files: createEncryptedFileStore({ directory: fileDirectory, key: Buffer.alloc(32, 5) }),
    ethCall: async () => "0x",
    now: () => Math.floor(Date.now() / 1000),
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600,
  });

  for (const institution of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(institution));
  }

  const officer = privateKeyToAccount(OFFICER_KEY as Hex);
  await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });

  const call = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));
  const json = async (url: string, init: RequestInit = {}) => (await call(url, init)).json();

  try {
    heading("1. Amil operasional masuk ruang kerja dengan menandatangani tantangan");
    const { challenge, typedData } = await json(`${WORKSPACE}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionId: SINAR, account: officer.address }),
    });
    const signature = await officer.signTypedData({
      ...typedData,
      message: {
        ...typedData.message,
        issuedAt: BigInt(typedData.message.issuedAt),
        expiresAt: BigInt(typedData.message.expiresAt),
      },
    } as never);
    const session = await json(`${WORKSPACE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce: challenge.nonce, signature }),
    });
    const token = session.token as string;
    say(`   ${officer.address} masuk sebagai ${session.role} pada ${session.institutionId}`);

    const prepare = (body: unknown) =>
      json(EVIDENCE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    heading("2. Dua ledger dengan selisih yang diketahui, dibekukan lalu direkonsiliasi");
    const first = (
      await prepare({
        label: "Rekonsiliasi akhir tahun 2024",
        period: { kind: "AKHIR_TAHUN", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: {
          manifest: manifest("CLAIM"),
          rows: [
            row("PZ-1401", "1500000000", "BAZNAS Kab. Kampar"),
            row("PZ-1471", "750000000", "BAZNAS Kota Pekanbaru"),
          ],
        },
        source: {
          manifest: manifest("SOURCE"),
          rows: [
            row("PZ-1401", "1200000000", "BAZNAS Kab. Kampar"),
            row("PZ-1471", "750000000", "BAZNAS Kota Pekanbaru"),
          ],
        },
        files: [
          {
            role: "SOURCE",
            fileName: "laporan-kinerja-kampar.csv",
            mimeType: "text/csv",
            contentBase64: Buffer.from("kode,nama,zakat\nPZ-1401,BAZNAS Kab. Kampar,1200000000\n").toString("base64"),
          },
        ],
      })
    ).preparation;

    say(`   Persiapan  : ${first.id}`);
    say(`   Hasil      : ${first.outcome}, seimbang = ${first.result.balanced}`);
    say(`   Selisih    : ${rupiah(first.result.netDelta.amount)} pada ${first.findings[0].key}`);
    say(`   Commitment : ${first.commitment.slice(0, 22)}… (${first.commitmentScheme})`);
    say(`   Berkas     : ${first.files[0].fileName} — ${first.files[0].storageStatus}`);

    heading("3. Masukan aktif berubah: angka sumber dikoreksi, persiapan baru dibuat");
    const second = (
      await prepare({
        label: "Rekonsiliasi akhir tahun 2024 (masukan terkoreksi)",
        period: { kind: "AKHIR_TAHUN", year: 2024 },
        currencyUnit: "IDR",
        balanceSheetScope: "ON",
        claim: {
          manifest: manifest("CLAIM"),
          rows: [
            row("PZ-1401", "1500000000", "BAZNAS Kab. Kampar"),
            row("PZ-1471", "750000000", "BAZNAS Kota Pekanbaru"),
          ],
        },
        source: {
          manifest: manifest("SOURCE"),
          rows: [
            row("PZ-1401", "1500000000", "BAZNAS Kab. Kampar"),
            row("PZ-1471", "750000000", "BAZNAS Kota Pekanbaru"),
          ],
        },
      })
    ).preparation;
    say(`   Persiapan  : ${second.id}`);
    say(`   Selisih    : ${rupiah(second.result.netDelta.amount)} — kedua sisi kini cocok`);

    heading("4. Snapshot pertama dibuka ulang");
    const reopened = await json(`${EVIDENCE}/${first.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const before = reopened.preparation;
    say(`   Selisih    : ${rupiah(before.result.netDelta.amount)} — tidak berubah`);
    say(`   Temuan     : ${before.findings.length} tersimpan`);
    say(`   Sumber     : baris PZ-1401 sisi sumber tetap ${rupiah(
      before.sources.find((s: any) => s.role === "SOURCE").rows[0].amount
    )}`);
    say(`   Commitment : ${reopened.commitmentVerified ? "cocok" : "TIDAK COCOK"}`);

    if (before.result.netDelta.amount !== "300000000" || !reopened.commitmentVerified) {
      throw new Error("Snapshot berubah setelah masukan aktif diubah. Demonstrasi gagal.");
    }

    heading("5. Pembaca publik: ringkasan boleh, berkas privat tidak");
    const summary = (await json(`${EVIDENCE}/${first.id}/public`)).summary;
    say(`   Ringkasan  : ${summary.outcome}, selisih ${rupiah(summary.netDelta.amount)}`);
    say(`   Baris      : ${JSON.stringify(summary).includes("1500000000") ? "BOCOR" : "tidak ada satu pun"}`);
    say(`   Salt       : ${JSON.stringify(summary).includes(before.commitmentSalt.slice(2)) ? "BOCOR" : "tidak dibawa"}`);

    const anonymous = await call(`${EVIDENCE}/${first.id}/files/${first.files[0].id}`);
    say(`   Unduh anonim: HTTP ${anonymous.status} — ditolak pada pengambilan berkasnya sendiri`);
    if (anonymous.status !== 401) {
      throw new Error("Pembaca publik dapat mengunduh berkas privat. Demonstrasi gagal.");
    }

    heading("Selesai.");
    say(
      "Snapshot dibekukan sebelum dihitung, hasilnya tersimpan bersama sumbernya, dan pembacaan\n" +
        "ulang tidak mengikuti perubahan data aktif. Pencatatan bukti di rantai, pengesahan lembaga,\n" +
        "vonis validator, dan atestasi auditor adalah tindakan terpisah yang belum ada pada rilis ini."
    );
  } finally {
    resetWorkspace();
    await client.close();
    await rm(directory, { recursive: true, force: true });
    await rm(fileDirectory, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDemonstrasi gagal:", error);
    process.exit(1);
  });
