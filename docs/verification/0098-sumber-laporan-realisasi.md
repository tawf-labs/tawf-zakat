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

- **AC07 (#100)**: uang muka dan beban dicatat terpisah dan tidak dijumlahkan ke bantuan penerima.
  - Per uang muka dibekukan `accountedIdr` (beban tertaut hingga cut-off) dan `unaccountedIdr`, dengan konsep yang sama seperti modul realisasi #95. Beban tertaut yang melebihi uang muka tampil sebagai selisih negatif dan dinyatakan di catatan cakupan, bukan dinolkan.
  - Total yang belum dipertanggungjawabkan pada cut-off (`unaccountedAdvancesIdr`) tercantum di catatan cakupan.
  - Penyerahan barang membawa `aidLineValuation` dari versi pengajuan: satuan, estimasi nilai dan dasar valuasinya. Nilai diakui hanya bila dasarnya dinyatakan (`goodsValuationOf`). Estimasi ini ditampilkan dan tidak dijumlahkan ke realisasi rupiah.
  - `quantityApproved` berasal dari garis yang diputuskan pada catatan keputusan versi itu (`proposal_decisions.decided_aid_lines_json`), tidak pernah dari draf aktif. Nilainya `null` hanya untuk keputusan lama yang belum dapat dipulihkan (lihat di bawah).

- **Kegiatan penyaluran dan penelusuran donatur (amandemen pilot, #102/#103)**
  - Setiap realisasi beku membawa `activityId`: kegiatan untuk pengajuan dan versi yang sama, yang sudah dibuat pada atau sebelum cut-off. Kegiatan versi lain atau yang dibuat sesudah cut-off tidak ditebak menjadi relasi.
  - `activityTrace` membekukan kegiatan terkait beserta alokasi kontribusi aktif hingga cut-off. Isinya: id kontribusi, versi kontribusi yang dialokasikan, nominal/unit, jenis dana, status kontribusi saat freeze, dan penanda `donorRecorded`. Juga total teralokasi per unit, teks cakupan penelusuran, dan disclaimer pendanaan dari modul kegiatan.
  - Nama dan kontak donatur tidak pernah dibekukan.
  - Kontribusi tanpa detail donatur dihitung sebagai `contributionsWithoutDonor` dan dinyatakan di catatan cakupan sebagai sumber donor tidak lengkap.
  - Realisasi tanpa kegiatan disebut di `realizationsWithoutActivity`.
  - Alokasi tidak dijumlahkan ke baris realisasi dan tidak menyatakan donatur tertentu membiayai penerima tertentu.
  - Jika store kegiatan tidak ada atau gagal dibaca, realisasi tetap dibekukan dan `activityTrace.available: false` menyebut alasannya.

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
    - Bagian "Kegiatan penyaluran & alokasi kontribusi hingga cut-off", serta nama kegiatan (atau "Belum terhubung ke kegiatan penyaluran") per realisasi.

## Batas yang belum dikerjakan pada tiket ini

- Pointer ke versi sertifikat NFT belum ada karena modul sertifikat/NFT belum ada di kode. Dependensi ke tiket sertifikat di bawah #100. Issue #98 menyatakan proof/mint bukan prasyarat sumber laporan.
- Realokasi/pembatalan alokasi (#107) belum ada; saat ini hanya alokasi `ACTIVE` yang dibekukan.
- Keputusan persetujuan yang tercatat sebelum kolom `decided_aid_lines_json` ada dipulihkan dengan `bun run proposal:decisions:verify` / `proposal:decisions:apply`. Skrip ini hanya menulis garis yang mereproduksi `rights_digest` bertanda tangan, bersumber dari draf aktif (bila belum direvisi) atau delta revisi pertama. Keputusan yang tidak cocok dilaporkan dan tetap kosong.
- Status konfirmasi/sengketa tidak direkonstruksi per cut-off, karena kolom status diperbarui di tempat. Status diambil saat pembekuan dan dinyatakan demikian.

## Pengujian yang dijalankan

- `bun test test/disbursement_realization_source_api.test.ts` dengan `REGISTRY_BROWSER_MODULE`/`REGISTRY_BROWSER_EXECUTABLE`: **22 pass, 0 fail**. Membutuhkan `anvil` dan artefak `sc/out` (port 18582). Cakupan:
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
  - AC07: sisa uang muka pada cut-off (beban sesudah cut-off tidak mengurangi), beban tanpa uang muka tetap terpisah, estimasi nilai dan dasar valuasi barang terbaca tanpa masuk baris/total rupiah. Unit: beban melebihi uang muka menjadi selisih negatif beserta catatannya.
  - AC15: ringkasan publik paket dengan kegiatan dan kontribusi tidak memuat nama donatur, id/referensi kontribusi, nama/NIK penerima, nama berkas provenance, locator, atau salt.
  - Kegiatan dan donatur:
    - Realisasi terhubung ke kegiatan; realisasi dari pengajuan tanpa kegiatan dinyatakan.
    - Alokasi sesudah cut-off tidak dibekukan.
    - Kontribusi tanpa donatur terhitung; nama donatur tidak muncul di provenance.
    - Baris dan total realisasi tidak berubah oleh alokasi.
    - Store kegiatan yang gagal tidak menggagalkan sumber.
    - Unit: kegiatan sesudah cut-off atau versi lain tidak ditautkan; tanpa store dinyatakan.
  - Registry lokal (Anvil + `ReportEvidenceRegistry`, ABI tidak diubah):
    - Laporan v1 dari sumber realisasi terbit dengan dua pengesahan (lembaga + validator) dan diatestasi auditor bermandat.
    - Sesudah realisasi susulan dan revisi nama penerima, koreksi v2 dari snapshot realisasi baru terbit dengan v1 sebagai pendahulu.
    - v1 tetap `PUBLISHED`, `DIGANTIKAN_KOREKSI`, dan atestasinya tetap satu entri miliknya. v2 `NOT_EXAMINED`.
    - Paket pemeriksaan v1 lolos `verifyExamination` terhadap chain lokal, dan berkas provenance realisasi di dalamnya `AVAILABLE` dengan isi lama ("Pak Arif").
  - Unit mapper: jenis dana tak dikenal, nilai rusak, versi hilang, pemetaan INFAK, uang muka/beban di luar cut-off, dokumen sesudah cut-off.
  - Smoke browser laptop + ponsel: mode realisasi di form; realisasi → paket bukti → versi laporan beku ("realisasi-smoke · versi 1"); revisi nama penerima pada pengajuan; drill-down sumber lama tetap menampilkan nama dan versi pengajuan saat dibekukan; sengketa sesudah freeze hanya muncul di kolom status terkini.
- Regresi: `registry_api` 47 (7 skip opt-in browser), `activity_allocation_api` 12, `contribution_api` 16, `disbursement_realization_api` 20, `disbursement_realization_goods_api` 18, `evidence_api` 58, `evidence_drafts_api` 20, `evidence_internal_usdc_api` 13, `evidence_source` 19, `period_report_api` 15 — semua pass.
- Suite backend penuh `cd backend && bun test`: **946 pass, 21 skip (opt-in browser), 0 fail** di 73 berkas.
- `cd frontend && bun run build`: berhasil.
