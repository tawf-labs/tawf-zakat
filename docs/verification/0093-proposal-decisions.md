# Issue #93 — keputusan lembaga dan pengesahan pencatatan pengajuan

Tanggal: 2026-09-17. Issue: https://github.com/tawf-labs/tawf-zakat/issues/93

## Hasil

- Suite #93 (`test/disbursement_decision_api.test.ts`): **17 pass, 0 fail**, 409 assertions, memakai PostgreSQL lokal (database `zkt`, port 5432, schema terisolasi `smoke_<uuid>`) dan Chromium headless.
- Regresi `disbursement_api`, `disbursement_examination_api`, `activity_allocation_api`, `workspace_mandate_api`, `beneficiary_import_api`: seluruhnya lulus (tes browser milik tiket lain tidak diaktifkan).
- Tes frontend `src/features`: **183 pass, 0 fail**.

Smoke browser memakai komponen ruang kerja asli dan tanda tangan nyata dari key fixture lokal:

1. Pejabat membuka telaah (hasil pemeriksaan, operator), mengunggah berkas SK, menyetujui sebagian (Rp400.000 dari Rp500.000), dan menandatangani. Keputusan tersimpan dengan hash SHA-256 berkas yang sama dengan isi yang diunggah.
2. Operator memilih akun pengesahan institusi (ERC-1271). RPC tidak dapat dihubungi, UI menampilkan hasil belum diketahui dan tidak ada keputusan tersimpan. Setelah RPC pulih, "Periksa hasil pengesahan" mengirim ulang operasi yang sama dan keputusan tercatat dengan akun pengesah berbeda dari akun operator.
3. Mandat dicabut saat dompet sedang menandatangani. Tanda tangan ditolak, bukan dilaporkan sebagai hasil belum diketahui, dan pengajuan tetap siap diputus.
4. Respons `/decide` ditahan, lalu pengguna keluar sebelum respons tiba. Respons terlambat untuk sesi lama tidak diterapkan pada UI. Setelah masuk lagi, hasil tersimpan dibaca ulang dan ditampilkan.

Tes HTTP juga mencakup AC29 spec pilot (#100):

- Pejabat lembaga lain yang punya mandat pemutus di lembaganya sendiri tidak dapat membaca telaah, mengunggah berkas SK, meminta tantangan, mengesahkan, membaca keputusan, atau mengunduh berkasnya (404). Menyebut `institutionId` lembaga lain ditolak (403).
- Tantangan yang ditandatangani untuk satu pengajuan tidak dapat dipakai untuk pengajuan lain.
- Sesi yang sudah logout, kedaluwarsa, atau keanggotaannya dicabut tidak dapat menerapkan tanda tangan (401), dan tidak ada yang tercatat. Pemilik sah yang masuk lagi tetap dapat memakai tantangan yang belum terpakai.

Tidak ada `pageerror`. Screenshot lokal: `/tmp/issue93-browser.png`.

## Menjalankan ulang

Dari direktori `backend`:

```bash
DECISION_TEST_DATABASE_URL="$LOCAL_SMOKE_DATABASE_URL" \
REGISTRY_BROWSER_MODULE="$LOCAL_PLAYWRIGHT_MODULE" \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/disbursement_decision_api.test.ts
```

Tanpa `DECISION_TEST_DATABASE_URL`, helper memakai PGlite terisolasi. Tanpa `REGISTRY_BROWSER_MODULE`, tes browser dilewati.

## Batas verifikasi

- Berkas SK disimpan terenkripsi terpisah dari dokumen pengajuan, agar pengunggahnya tidak tercatat sebagai penyusun. Tanda tangan mengikat hash berkas, bukan isinya; unduhan diperiksa ulang terhadap hash tersebut.
- Akun kontrak institusi diverifikasi dengan `eth_call` terkendali pada tes, bukan EVM lokal atau jaringan publik.
- Smoke memverifikasi interaksi pada bundle tanpa CSS produksi dan dompet sintetis, bukan ekstensi dompet nyata.
