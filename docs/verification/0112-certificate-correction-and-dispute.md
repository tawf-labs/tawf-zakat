# Koreksi dan sengketa pada NFT distribusi — #112

Mengimplementasikan #112 terhadap spec #100 dan ADR-0035 (Q39). Dokumen ini
menjelaskan kebijakan dan batas pemeriksaan, bukan bukti deployment pilot.

## Kebijakan

- **Satu garis resmi per sertifikat.** Versi 1 memakai id sertifikat; penerus
  memakai `<id>@<versi>` sebagai id percobaan, sedangkan pernyataan yang
  ditandatangani memakai id sertifikat asli dengan `version` dan `predecessor`.
- **Kontrak.** `predecessor` yang tidak kosong wajib sama dengan versi resmi
  terkini garis itu (`WrongPredecessor` jika tidak), kegiatan tidak boleh
  berpindah (`OutOfScope`), versi tidak boleh berulang. Token lama tidak diubah;
  hanya `successorOf`/`predecessorOf` dan event `CertificateSuperseded` ditambah.
  Dua penerus bersaing atas pendahulu yang sama tidak bisa sama-sama mint.
- **Alasan terikat pada tanda tangan** lewat commitment isi: isi penerus memuat
  `correction {reason, note, predecessorVersion, predecessorDigest}`.
- **Cakupan penerus = realisasi pendahulu**, dibaca ulang. Realisasi baru
  setelah pembekuan adalah tahap lain, bukan perubahan sertifikat lama; revisi
  pengajuan/penutupan sisa tidak menyentuh isi maupun menerbitkan NFT.
- **Sumber vs. sengketa.** Dibandingkan hanya nominal, kuantitas, satuan, status
  konfirmasi. Kekurangan dokumen tidak pernah menjadi sengketa/perubahan.
  `sourceStatus`: MATCHES / CHANGED / DISPUTED.
- **Koreksi ditolak** bila alasan tidak didukung sumber (`SOURCE_CORRECTION`
  butuh perubahan; `DISPUTE_DISCLOSURE` butuh sengketa terbuka), bila tanpa
  perubahan, bila pendahulu belum terkonfirmasi, atau bila sudah ada penerus
  disahkan. Draf serupa yang masih segar dipakai ulang; jika tidak, nomor versi
  baru diambil dan draf lama tetap sebagai riwayat tak terbit.
- **Slot penerus tunggal** (`certificate_successor_claims`) diambil dalam
  transaksi SQL yang sama dengan penyimpanan transaksi bertanda tangan. Pemegang
  yang transaksinya REVERTED (atau tak pernah menyimpan tanda tangan) dapat
  digantikan; pending/reorg tetap menahan slot.

## Keberlakuan (`validity`)

CURRENT hanya jika mint sendiri CONFIRMED, tak ada penerus dalam keadaan apa
pun selain draf, dan cakupan tidak berubah/tidak disengketakan. Urutan:
SUPERSEDED > REPLACEMENT_FAILED > REPLACEMENT_PENDING > DISPUTED >
SOURCE_CHANGED > PENDING_CONFIRMATION > CURRENT. Kegagalan atau reorg penerus
tidak pernah mengembalikan pendahulu ke CURRENT. `replacement` membedakan
PREPARED, ENDORSED_PENDING_MINT, INCLUDED_PENDING_CONFIRMATION,
NONCANONICAL_PENDING, CONFIRMED, FAILED, UNVERIFIED_CHAIN_SUCCESSOR (penerus di
chain yang tak dikenal catatan lembaga; head publik ditahan 503).

## API

- `POST …/certificates/:id/correct`
  `{institutionId, reason, note, expectedPredecessorVersion}` → 201,
  disahkan lewat `submit`/`retry` yang ada (butuh ISSUE_CERTIFICATES + mandat).
  `expectedPredecessorVersion` wajib membawa versi yang ditinjau pengguna;
  versi yang sudah tertinggal ditolak 409, bukan dialihkan ke pendahulu baru.
  Persiapan paralel yang berbenturan ditolak 409, bukan mengembalikan draf
  dengan alasan/catatan/pengesah milik permintaan lain. Retry draf serupa hanya
  dipakai ulang jika deadline dan epoch mandatnya masih berlaku.
- `GET …/certificates/:id/history` — baca saja untuk pembaca ruang kerja
  (mis. auditor); tidak ada kemampuan menyiapkan/menandatangani/mengoreksi.
- Publik: `GET /api/public/certificates/:inst/:id` (versi resmi terkini) dan
  `…/versions/:version` (versi historis), dengan `validity`, `scope`,
  `replacement`, `predecessor`, `history`. Catatan koreksi bebas-teks tidak publik.

## Verifikasi

`backend/test/distribution_certificate_correction.test.ts` (HTTP + PGlite +
tanda tangan EIP-712 + Anvil, termasuk smoke browser 1280→390 dengan CSS nyata),
Foundry `DistributionCertificateNFTTest` (18 tes), suite #111 tetap lulus.
Mencakup sengketa setelah mint, dokumen kurang bukan sengketa, penyelesaian dan
koreksi berantai, dua penerus bersaing (HTTP paralel dan kontrak), penerus
liar di chain, reorg/gagal, issuer/mandat dicabut, pembaca tak bisa mengoreksi,
integritas isi historis, restart, benturan persiapan paralel, draf kedaluwarsa,
pembaruan epoch mandat, penolakan versi pendahulu usang tanpa draf tambahan,
dan allowlist field riwayat publik tanpa catatan koreksi privat. Smoke browser
juga memeriksa versi pendahulu pada request koreksi. Perintah:

```sh
cd sc && forge test --match-contract DistributionCertificateNFTTest
cd backend && bun test test/distribution_certificate_correction.test.ts
REGISTRY_BROWSER_MODULE=… REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium bun test test/distribution_certificate_correction.test.ts
```

## Batas dan rollout

- Kontrak berubah (fungsi/event/error baru, ABI diekspor ulang): deployment
  baru diperlukan; tidak ada deployment atau transaksi pilot dilakukan di sini.
- Skema aditif (`certificate_id`, `version`, `certificate_successor_claims`)
  dengan backfill idempoten dari baris #111 di `ensureSchema()`.
- Tidak diuji: penggantian slot setelah penerus REVERTED di chain nyata (hanya
  tingkat store); reason bebas-teks tidak dimoderasi.
