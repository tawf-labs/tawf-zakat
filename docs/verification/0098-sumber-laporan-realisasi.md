# Verifikasi Sumber Laporan dari Realisasi dan Penelusuran Bukti — #98

Acuan: issue #98, spec #86, amandemen pilot #100, ADR-0027/0028/0029.

## Perilaku

- **Stream internal `DISBURSEMENT_REALIZATIONS`**
  - Ditawarkan pada `GET /api/evidence/internal-sources` (IDR, neraca `ON`). Jika pembacaan penyimpanan gagal, stream dinyatakan `available: false` dengan sisi `FAILED`, bukan sumber kosong.
  - Diterima pada `POST /api/evidence` sebagai `source.internal` (atau `claim.internal`) dengan `stream` dan `cutOff` ISO 8601. Cakupan: lembaga sesi, periode paket, dan cut-off.

- **Periode dan cut-off**
  - Realisasi yang dilaporkan di luar periode berada di luar cakupan.
  - Realisasi dalam periode yang dicatat/dilaporkan sesudah cut-off **belum terperiksa, bukan tidak ada**. Realisasi ini tidak dicatat sebagai *catatan belum terverifikasi*. Sebagai gantinya, ia disebut di catatan cakupan dan di `excludedAfterCutOff` pada provenance.
  - Dokumen bukti dan sengketa yang dibuat sesudah cut-off tidak ikut dibekukan. Status bukti/konfirmasi/sengketa dibekukan sebagaimana terbaca saat snapshot dibuat. Catatan cakupan menyatakan hal ini secara eksplisit.
  - Uang muka dan beban dibatasi oleh periode dan cut-off yang sama.

- **Catatan belum terverifikasi (tidak dapat dibuktikan)**
  - Jenis dana program yang tidak dikenali tidak ditebak menjadi ZAKAT.
  - Nilai rupiah yang bukan bilangan bulat sah.
  - Versi pengajuan yang dirujuk realisasi tidak ditemukan. Data tidak diisi dari draf aktif.
  - Barang tanpa dasar valuasi rupiah. Kuantitasnya tetap dicatat per satuan.

- **Jenis dana manifest**: hanya jenis dana yang benar-benar tercakup (INFAK/SEDEKAH → `INFAK_SEDEKAH`, LAINNYA → `DSKL`). Sumber kosong mencakup seluruh jenis dana dengan hasil nol.

- **AC07**: uang muka dan beban dicatat terpisah dan tidak dijumlahkan ke bantuan penerima.

- **Sumber kosong vs gagal**
  - Sumber kosong: `READ` tanpa baris, dengan catatan "terbaca penuh dan tidak memuat realisasi". Tidak ada klaim "Rp 0 untuk 0 penerima".
  - Pembacaan gagal: sisi `FAILED`, hasil `INCOMPLETE`, tanpa berkas provenance.

- **Provenance beku**
  - Berkas `realization-provenance-claim.json` / `realization-provenance-source.json` per sisi (format `tawf.realization.provenance` v2). Tipe dibagi frontend/backend di `shared/realization-provenance.ts`.
  - Nama berkas ini dicadangkan. Lampiran yang memakai nama tersebut ditolak (400) pada `POST /api/evidence` maupun draf.
  - Drill-down hanya mempercayai berkas bernama tercadang milik sisi yang dibangun server dari stream realisasi.
  - NIK disamarkan (`maskNik`) sebelum masuk provenance.

- **Drill-down `GET /api/evidence/:id/drill-down`**
  - Mengembalikan `provenances[]` per sisi.
  - Sisi yang berkasnya hilang/rusak/tak tersedia disebut di `unreadable[]` beserta alasannya dan tidak dijawab sebagai rincian kosong. Berkas hilang atau isinya tidak cocok dengan hash → `FAILED`. Penyimpanan belum terjangkau → `UNAVAILABLE`.
  - Hanya pembaca lembaga pemilik: lembaga lain mendapat 404, tanpa sesi 401.
  - Paket rekap → `NOT_AVAILABLE`. Paket tanpa sumber realisasi → `NO_REALIZATION_SOURCE`.
  - `current` memuat status operasional terkini per realisasi yang dibekukan (status bukti, konfirmasi, jumlah dokumen, penerimaan diperselisihkan) beserta `observedAt`. Blok ini dibaca dari data kerja, ditampilkan berdampingan, dan tidak ditulis ke snapshot. Jika gagal dibaca, `current.available: false` beserta alasannya, sementara rincian beku tetap tersedia.

- **UI**
  - `EvidencePreparationForm`: mode "Realisasi Penyaluran" (ikon Lucide) dengan pemilih cut-off. Editor JSON manual hanya tampil pada mode JSON manual. Mode bawaan tetap spreadsheet.
  - `RealizationDrillDownCard`:
    - Rincian per sisi.
    - Tombol `vN` membuka versi pengajuan yang tepat (`GET /proposals/:id/versions/:v`) beserta penerima pada versi itu.
    - Setiap dokumen dapat diunduh lewat rute dokumen realisasi yang memeriksa hash.
    - Sengketa ditampilkan sebagai "Penerimaan diperselisihkan".
    - Kolom "Status terkini" dengan waktu bacanya, ditandai "Berubah sejak dibekukan" atau "Sama dengan snapshot".

## Batas yang belum dikerjakan pada tiket ini

- Integrasi registry (pencatatan/penerbitan onchain dan atestasi versi lama) untuk paket bersumber realisasi belum diuji dengan harness Anvil lokal. Jalur koreksi-atestasinya generik dan diuji di `registry_api.test.ts`.
- Hubungan realisasi ke kegiatan penyaluran (#103) belum dibekukan dalam provenance.
- Penelusuran donatur dan pointer ke versi sertifikat NFT (amandemen pilot) belum ada.
- Status konfirmasi/sengketa tidak direkonstruksi per cut-off, karena kolom status diperbarui di tempat. Status diambil saat pembekuan dan dinyatakan demikian.

## Pengujian yang dijalankan

- `bun test test/disbursement_realization_source_api.test.ts` dengan `REGISTRY_BROWSER_MODULE`/`REGISTRY_BROWSER_EXECUTABLE`: **16 pass, 0 fail**. Cakupan:
  - Cut-off → belum terperiksa.
  - Revisi pengajuan sesudah freeze.
  - Rekap `NOT_AVAILABLE`.
  - Privasi publik.
  - Sumber kosong vs gagal.
  - Nama berkas provenance tercadang.
  - Sengketa sesudah cut-off dan sesudah freeze.
  - Status terkini berdampingan: sengketa baru terlihat di `current`, snapshot tetap; pembacaan status terkini yang gagal tidak menjatuhkan drill-down.
  - Isolasi: officer lembaga lain mendapat 404 untuk drill-down dan berkas provenance; tanpa sesi mendapat 401.
  - Integritas: berkas provenance yang isinya diganti atau dihapus dari penyimpanan terenkripsi dinyatakan `FAILED` di `unreadable`, bukan rincian kosong.
  - Koreksi laporan: paket laporan v2 dari snapshot baru merujuk v1 sebagai pendahulu (preview koreksi menampilkan digest v1). Digest/angka v1 tidak berubah, dan drill-down sumber v1 tetap memuat data sebelum realisasi susulan dan revisi nama.
  - Unit mapper: jenis dana tak dikenal, nilai rusak, versi hilang, pemetaan INFAK, uang muka/beban di luar cut-off, dokumen sesudah cut-off.
  - Smoke browser laptop + ponsel: mode realisasi di form; realisasi → paket bukti → versi laporan beku ("realisasi-smoke · versi 1"); revisi nama penerima pada pengajuan; drill-down sumber lama tetap menampilkan nama dan versi pengajuan saat dibekukan; sengketa sesudah freeze hanya muncul di kolom status terkini.
- Regresi: `disbursement_realization_api` 20, `disbursement_realization_goods_api` 18, `evidence_api` 58, `evidence_drafts_api` 20, `evidence_internal_usdc_api` 13, `evidence_source` 19, `period_report_api` 15 — semua pass.
- `cd frontend && bun run build`: berhasil.
