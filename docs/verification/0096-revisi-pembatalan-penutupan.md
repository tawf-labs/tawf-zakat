# Issue #96 — Revisi, Pembatalan, dan Penutupan Sisa Pengajuan

Verifikasi lokal 2026-09-18. Acuan: [#96](https://github.com/tawf-labs/zkt-hackathon/issues/96), [#86](https://github.com/tawf-labs/zkt-hackathon/issues/86) (US-34, US-42, US-43, US-44, US-50, US-55; Skenario 9, 12, 17, 18, 19, 25), ADR-0028, dan ADR-0029.

## Perbaikan dan Fitur yang Diverifikasi

### 1. Revisi Pengajuan yang Disetujui (Approved Proposal Revision)
- **Pengajuan Revisi**: Amil dapat mengajukan revisi atas pengajuan berstatus `APPROVED` untuk menyesuaikan daftar penerima manfaat maupun rincian hak bantuan (`POST /proposals/:id/revisions`).
- **Aturan Batas Bawah Realisasi (Floor Rule)**: Hak bantuan tidak dapat dikurangi di bawah jumlah yang telah terealisasi pada rincian bantuan terkait (`validateRevisionFloor`). Jika nominal IDR atau kuantitas barang yang diajukan lebih kecil dari yang telah terealisasi, sistem menolak dengan `RevisionCapFloorError` (HTTP 409). Rincian bantuan yang telah terealisasi tidak dapat dihapus.
- **Penahanan Realisasi Berjalan (Realization Hold Rule)**: Garis bantuan yang ditambah atau diubah masuk ke dalam daftar penahanan (`heldAidLineIds`). Realisasi pada garis yang ditahan ditolak dengan `RealizationHeldForRevisionError` (HTTP 409). Garis bantuan yang tidak disentuh oleh revisi tetap dapat disalurkan normal berdasarkan versi aktif yang sedang berjalan.
- **Siklus Telaah Revisi Independen**: Alur pemeriksaan revisi (`SUBMITTED` → `UNDER_EXAMINATION` → `REVISION_REQUIRED` / `READY_FOR_DECISION`) berjalan tanpa menimpa atau merusak versi pengajuan yang sedang aktif. Amil dapat menarik revisi (`WITHDRAWN`) yang membebaskan garis yang ditahan tanpa menaikkan versi.
- **Perbaikan Revisi yang Dikembalikan**: Revisi berstatus `REVISION_REQUIRED` dapat diperbaiki isinya dan dikembalikan ke antrean pemeriksaan (`POST /proposals/:id/revisions/:revId/amend`) tanpa menyentuh versi pengajuan yang berlaku.
- **Pemeriksaan Ulang Memakai Gerbang yang Sama**: `POST .../ready` pada revisi menuntut checklist pemeriksaan yang ditegaskan, lewat validator yang sama dengan pengajuan awal (`validateExaminationChecklist`).
- **Pengesahan Keputusan Revisi Kriptografis**: Pejabat lembaga memeriksa ringkasan perubahan dan menandatangani tantangan EIP-712 (`action: "APPROVE"` atau `"REJECT"`). Pemisahan tugas ditegakkan pada keputusan revisi: penyusun dan pemeriksa versi revisi tidak boleh menjadi pengesahnya, dan aturan itu diperiksa ulang saat penyerahan tanda tangan, bukan hanya saat tantangan dibuat. Saat disetujui, versi pengajuan bertambah secara atomik, hak bantuan yang baru diberlakukan, garis penahanan dilepaskan, dan entri versi baru dicatat ke `proposal_versions`. Snapshot versi yang sudah beku tidak pernah ditimpa: bila versi tujuan sudah terisi, sistem menolak dengan `RevisionSupersededError` (HTTP 409) agar pemanggil membaca ulang.

### 2. Pembatalan Pengajuan (Proposal Cancellation)
- **Syarat Mutlak Realisasi Nol**: Pembatalan pengajuan hanya diizinkan jika `realizations.length === 0`. Upaya membatalkan pengajuan yang sudah memiliki satu kejadian realisasi (meski bukti belum lengkap) ditolak dengan `ProposalCancellationConflictError` (HTTP 409).
- **Pengesahan Ber-SK & Kriptografis**: Memerlukan nomor SK pembatalan, tanggal penetapan SK, unggahan berkas dokumen SK yang terikat hash SHA-256, dan tantangan penandatanganan EIP-712 (`action: "CANCEL"`).
- **Transisi Status**: Pengajuan bertransisi secara permanen ke `CANCELLED` (`Dibatalkan`). Tidak ada realisasi atau revisi lebih lanjut yang diizinkan.

### 3. Penutupan Sisa Hak Pengajuan (Proposal Remainder Closure)
- **Syarat Realisasi Bertahap**: Penutupan sisa pengajuan hanya diizinkan jika pengajuan telah memiliki realisasi (`realizations.length > 0`) dan masih memiliki sisa hak bantuan (uang IDR atau barang). Jika belum ada realisasi atau sisa hak sudah nol, sistem menolak dengan `ProposalClosureConflictError` (HTTP 409).
- **Pengesahan Ber-SK & Kriptografis**: Memerlukan nomor SK penutupan sisa, tanggal penetapan SK, unggahan berkas dokumen SK yang terikat hash SHA-256, dan tantangan penandatanganan EIP-712 (`action: "CLOSE_REMAINDER"`).
- **Pencatatan Rincian Penutupan Sisa**: Sistem secara deterministik menghitung sisa hak per baris bantuan serta total nominal uang dan kuantitas barang per unit (`calculateRemainderClosure`), lalu menyimpannya pada kolom `proposal_drafts.remainder_closed_json` dan membacanya kembali lewat `GET /proposals/:id/closure`. Jumlah tersalur dan jumlah tidak disalurkan dicatat terpisah; tidak ada tabel `proposal_closures`.
- **Transisi Status**: Pengajuan bertransisi ke `REMAINDER_CLOSED` (`Sisa ditutup`). Tidak ada pencatatan realisasi baru yang diizinkan setelahnya.

### 4. Konkurensi Atomik dan Ketahanan Data
- Penyimpanan dan pengesahan menggunakan isolasi transaksi (`FOR UPDATE`) dan idempotensi `DraftOperation`.
- Seluruh mutasi revisi (`revisions`, `withdraw`, `start-examination`, `return`, `amend`, `ready`) menerima `operationId`, sehingga retry identik memutar ulang hasil yang sudah tersimpan alih-alih membuat keputusan atau revisi kedua. Payload berbeda di bawah `operationId` yang sama ditolak sebagai konflik (HTTP 409).
- Data revisi, penutupan sisa, pembatalan, dan tantangan EIP-712 bertahan melintasi restart database SQL.

### 4b. Batas Efek Keuangan
- Penutupan sisa tidak membuat realisasi, refund, saldo, atau pemindahan alokasi apa pun. Jumlah tersalur tetap apa adanya dan sisa yang ditutup dilaporkan terpisah; UI menyatakan batas ini secara eksplisit kepada operator. Diuji pada `disbursement_revision_api.test.ts`.
- Aturan batas bawah realisasi terkurung pada rincian hak bantuan pengajuan: modul kontribusi tidak mengimpor `validateRevisionFloor`, sehingga aturan ini tidak dapat dipakai menolak koreksi nominal kontribusi yang sah.

**Di luar lingkup tiket ini.** Amandemen pilot [#100](https://github.com/tawf-labs/tawf-zakat/issues/100) adalah spec induk bagi tiket di atas nomor 100. Pembedaan koreksi nominal kontribusi dari revisi hak bantuan, pengalihan sisa alokasi, refund, serta AC10/AC11/AC12/AC19/AC23/AC24/AC26 pada spec pilot **belum dikerjakan dan belum diuji di sini**; keduanya milik siklus kontribusi/alokasi pada tiket turunan (#97, #98, #107, #112) yang tiket ini blokir.

### 5. Antarmuka Pengguna (UI/UX)
- `STATUS_BADGES`: Menampilkan badge `CANCELLED` ("Dibatalkan") dan `REMAINDER_CLOSED` ("Sisa Ditutup").
- `ProposalDecisionBanner`: Menampilkan informasi rujukan SK, tanggal penetapan, akun operator, akun pengesah, sidik hak bantuan, tautan unduhan SK, serta tabel rincian sisa hak yang ditutup per rincian bantuan untuk pengajuan yang sisa haknya ditutup.
- `ProposalRealizationBanner`: Tombol aksi "Ajukan revisi", "Batalkan pengajuan" (kondisional 0 realisasi), dan "Tutup sisa" (kondisional >0 realisasi & ada sisa hak). Menampilkan peringatan garis yang sedang ditahan (`heldAidLineIds`).
- `ProposalRevisionModal` & `RevisionDeltaReview`: Form penyesuaian penerima dan hak bantuan dengan tinjauan visual diff (ditambah, diubah, dihapus, ditahan). Pratinjau delta dan validasi floor di browser memanggil inti murni yang sama dengan server (`shared/proposal-revision.ts`, ADR-0017 §1), sehingga pratinjau tidak dapat berbeda dari putusan server.
- `ProposalCancellationModal` & `ProposalClosureModal`: Keduanya memakai satu hook `useProposalTermination` (unggah SK → tantangan → tanda tangan → kirim), mewajibkan alasan keputusan, dan menahan tanda tangan yang hasilnya belum diketahui untuk dikirim ulang dengan `operationId` yang sama.
- `RevisionWorkflowBanner` & `RevisionDecisionModal`: Banner alur telaah revisi dan modal pengesahan revisi dengan integrasi dompet EIP-712. Checklist pemeriksaan versi revisi diisi di banner sebelum "Nyatakan Siap Diputus" dapat ditekan.
- Seluruh label pada modal revisi, pembatalan, penutupan sisa, dan keputusan revisi terikat pada inputnya (pola `<label>` membungkus input seperti `DecisionFormFields`), sehingga terbaca pembaca layar dan dapat didorong pengujian berbasis peran.

---

## Pemetaan Kriteria Tiket #96

| Kriteria / Skenario | Bukti Implementasi & Pengujian |
| --- | --- |
| **Skenario 17**: Pembatalan pengajuan yang belum terealisasi | `disbursement_revision_api.test.ts` menguji pembatalan dengan rujukan SK, unggahan dokumen SK, tantangan penandatanganan EIP-712, dan transisi ke `CANCELLED`. |
| **Penolakan pembatalan jika ada realisasi** | `disbursement_revision_api.test.ts` memverifikasi penolakan (HTTP 409) saat mencoba membatalkan pengajuan yang sudah memiliki realisasi. |
| **Skenario 18 & 19**: Penutupan sisa hak setelah realisasi bertahap | `disbursement_revision_api.test.ts` menguji penutupan sisa hak bantuan uang dan barang, kalkulasi sisa eksak, penyimpanan rincian pada `remainder_closed_json`, dan transisi ke `REMAINDER_CLOSED`. |
| **Skenario 9 & 12**: Revisi pengajuan, aturan floor, dan penahanan garis | `disbursement_revision_api.test.ts` menguji pengajuan revisi, penolakan penurunan hak di bawah realisasi (floor rule), penahanan realisasi pada garis yang diubah, keberhasilan realisasi pada garis yang tidak diubah, serta pengesahan versi baru via EIP-712. |
| **Penarikan revisi (withdraw)** | `disbursement_revision_api.test.ts` menguji amil menarik revisi dan membebaskan garis yang ditahan tanpa menaikkan versi aktif. |
| **Retry identik tidak menggandakan keputusan** | `disbursement_revision_api.test.ts` menguji pengiriman ulang pembatalan yang sudah ditandatangani mengembalikan keputusan yang sama, payload berbeda ditolak 409, dan retry `POST /revisions` mengembalikan revisi yang sama. |
| **Realisasi bersaing dengan penutupan sisa** | `disbursement_revision_api.test.ts` menguji realisasi yang datang setelah penutupan ditolak dan angka yang sudah ditutup tidak berubah. |
| **Pemisahan tugas pada keputusan revisi** | `disbursement_revision_api.test.ts` menguji penyusun revisi ditolak (HTTP 403) saat meminta tantangan pengesahan atas revisinya sendiri. |
| **Gerbang pemeriksaan revisi** | `disbursement_revision_api.test.ts` menguji `ready` ditolak (HTTP 400) tanpa checklist maupun dengan checklist yang belum ditegaskan. |
| **Loop kembali-perbaiki-periksa ulang** | `disbursement_revision_api.test.ts` menguji revisi `REVISION_REQUIRED` diperbaiki lewat `amend` dan kembali ke `SUBMITTED` tanpa menyentuh versi berlaku. |
| **Rincian bantuan bersatuan (barang)** | `disbursement_revision_api.test.ts` menguji hak barang tidak boleh turun di bawah kuantitas terealisasi (penolakan menyebut kuantitas, bukan rupiah), tepat di batas diperbolehkan, satuan yang sudah terealisasi tidak dapat diubah, barisnya tidak dapat dihapus, dan penutupan sisa mencatat sisa per satuan terpisah dari yang sudah diserahkan. |
| **Revisi bersaing menolak menimpa versi beku** | `disbursement_revision_api.test.ts` mengisi versi tujuan di belakang revisi, lalu memastikan pengesahan ditolak (HTTP 409) dengan arahan membaca ulang, dan pengajuan tetap utuh di versinya sendiri. |
| **Skenario 25: smoke browser** | `disbursement_revision_api.test.ts` menjalankan Chromium untuk tiga alur: amil menyusun dan mengirim revisi (banner alur menampilkannya); revisi yang disusun amil dan diperiksa pemeriksa lain disahkan ulang penuh dari UI lewat `RevisionDecisionModal` hingga berstatus "Revisi Disetujui"; dan penutupan sisa dijalankan penuh dari UI dengan jejak keputusannya (SK, alasan, tersalur vs tidak disalurkan) terbaca setelah pengajuan dibuka ulang. |
| **Ketahanan lintas restart database** | `disbursement_revision_api.test.ts` menguji kelangsungan data revisi, penutupan sisa, dan pembatalan setelah database ditutup dan dibuka kembali. |
| **Kompatibilitas regresi penyaluran uang & barang** | Semua pengujian regresi realisasi IDR, barang desimal, BAST kelompok, dan keputusan institusional tetap lulus tanpa galat. |

---

## Hasil Pengujian

- **Regresi Backend penuh**: `bun test backend/test` — **900 lulus, 19 dilewati, 1 gagal**. Satu-satunya kegagalan (`relayer.test.ts`, "Unconfigured live relayer fails closed") sudah ada sejak `HEAD` dan tidak berkaitan dengan tiket ini.
- **Suite #96**: `backend/test/disbursement_revision_api.test.ts` — **18 lulus, 0 gagal** (17 API + 1 smoke browser Chromium).
- **Frontend Unit Tests**: **199 lulus, 0 gagal**.
  - Termasuk test suite baru untuk Ticket #96 pada `disbursementClient.test.ts` yang menguji semua endpoint API revisi, pembatalan, penutupan sisa, dan challenge signing.
- **Frontend Production Build**: **Berhasil** (`bun run build` via Vite + Nitro node-server).

---

## Cara Menjalankan Ulang

Dari root direktori repositori:

```bash
# Menjalankan suite pengujian backend revisi, pembatalan, dan penutupan sisa
bun test backend/test/disbursement_revision_api.test.ts

# Menjalankan smoke browser Skenario 25 (butuh Chromium; dijalankan dari direktori frontend
# agar bundel smoke dapat me-resolve dependensi UI)
cd frontend && REGISTRY_BROWSER_MODULE=<path/ke/playwright-core/index.mjs> \
  REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
  bun test ../backend/test/disbursement_revision_api.test.ts -t browser

# Menjalankan seluruh regresi backend penyaluran bantuan
bun test backend/test/disbursement_revision_api.test.ts backend/test/disbursement_realization_goods_api.test.ts backend/test/disbursement_realization_api.test.ts backend/test/disbursement_decision_api.test.ts backend/test/disbursement_examination_api.test.ts backend/test/disbursement_api.test.ts

# Menjalankan pengujian frontend dan build produksi
cd frontend
bun test
bun run build
```
