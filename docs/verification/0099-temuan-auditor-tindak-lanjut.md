# Verifikasi Temuan Auditor, Tanggapan Amil, dan Tindak Lanjut Pemeriksaan — #99

Acuan: issue #99, spec #86 (US-03, US-51–59, AC11, AC20–25), amandemen pilot #100 (AC15, AC19, AC23, AC24, AC26, AC28, AC29, AC30), ADR-0028/0029/0030.

## Perilaku yang Diimplementasikan

- **Pengikatan Identitas Versi Laporan & Paket Bukti (AC20)**
  - Temuan audit mengikat secara eksak: `institution_id`, `preparation_id`, `package_id`, `package_digest`, `report_id`, dan `version`.
  - Temuan tidak pernah dialamatkan ke `report_id` semata tanpa ikatan versi dan paket bukti yang dibekukan.
  - Opsi penargetan spesifik ke objek audit: `target_proposal_id`, `target_proposal_version`, `target_realization_id`, `target_document_id`.

- **Pemisahan Wewenang & Batas Peran (AC11, AC21)**
  - Akun dengan keanggotaan `READER` ditolak saat mencoba mencatat temuan audit (`403 Akun pembaca biasa tidak dapat menulis temuan sebagai auditor`).
  - Akun petugas amil wajib memiliki mandat aktif `HANDLE_REPORT_EXAMINATION` untuk dapat memberikan tanggapan atas temuan (`403 Wewenang ditolak`).
  - Petugas amil **TIDAK BISA** bertindak sebagai auditor independen ataupun menutup temuan audit sendiri (`403 Forbidden`).
  - Hanya akun auditor yang berwenang (dan pencatat temuan) yang dapat memberikan tindak lanjut dan menutup temuan (`DITUTUP_AUDITOR`).

- **Siklus Hidup Temuan & Jejak Append-Only (AC21, AC22, AC26, AC28)**
  - Siklus hidup status temuan: `OPEN` → `DITANGGAPI` → `DITINDAKLANJUTI` → `DITUTUP_AUDITOR`.
  - Riwayat peristiwa (`report_audit_finding_events`) bersifat murni append-only.
  - Peristiwa tercatat:
    - `FINDING_CREATED`: Pembukaan temuan oleh auditor.
    - `AMIL_RESPONSE`: Tanggapan dan klarifikasi oleh amil.
    - `AUDITOR_FOLLOWUP`: Tindak lanjut auditor (`MINTA_KLARIFIKASI_LANJUTAN` atau `BUTUH_KOREKSI_LAPORAN`).
    - `AUDITOR_CLOSED`: Keputusan penutupan temuan oleh auditor (`SELESAI_DITUTUP`).
  - Status temuan dan riwayat peristiwa tidak dapat ditimpa atau dihapus.

- **Antrean Kerja (AC24)**
  - Endpoint `GET /api/evidence/audit-findings/queues` memproyeksikan dua antrean aksi:
    - `amilActionQueue`: Temuan dengan status `OPEN` atau `DITINDAKLANJUTI` yang membutuhkan aksi/klarifikasi tim amil.
    - `auditorReviewQueue`: Temuan dengan status `DITANGGAPI` yang membutuhkan evaluasi atau penutupan oleh auditor.

- **Privasi Berkas Kertas Kerja & Integritas SHA-256 (AC23, AC25)**
  - Berkas kertas kerja auditor (`is_owner_only = 1`) dilindungi secara ketat: akun amil tidak dapat mengunduh berkas ini (`403 Kertas kerja auditor privat hanya dapat diakses oleh pemeriksa`).
  - Berkas lampiran umum dari amil (`is_owner_only = 0`) dapat diunduh oleh kedua belah pihak (amil dan auditor) untuk pemeriksaan.
  - Seluruh berkas disimpan terenkripsi via `runtime.files` dan diverifikasi integritasnya menggunakan SHA-256 digest sebelum disajikan.

- **Isolasi Multi-Penyewa (Tenant Isolation) & Ringkasan Publik (AC29, AC30)**
  - Lembaga lain (misal Lembaga B terhadap temuan Lembaga A) tidak dapat melihat (`404`) maupun menanggapi (`404`/`403`) temuan audit milik lembaga lain.
  - Endpoint ringkasan publik (`GET /api/public/reports/:packageId`) maupun penyimpanan `public_report_summaries` tidak pernah membocorkan judul temuan, deskripsi, catatan klarifikasi amil, identitas pemeriksa, maupun locator berkas privat.

- **Antarmuka Pengguna (UI/UX)**
  - `AuditFindingQueuePanel`: Panel antrean kerja dua tab (Antrean Tindak Lanjut Amil & Antrean Tinjauan Auditor) dengan lencana status, indikator jumlah antrean, pencarian/filter, dan akses detail modal.
  - `AuditFindingDetailModal`: Modal komprehensif menampilkan metadata pengikatan versi, linimasa peristiwa append-only kronologis dengan avatar peran (Auditor vs Amil), daftar lampiran dengan unduhan langsung, form tanggapan amil, dan form keputusan tindak lanjut auditor.
  - `CreateAuditFindingModal`: Form modal untuk auditor mencatat temuan baru lengkap dengan pemilih lingkup, tingkat keparahan, target pengajuan/realisasi/dokumen, serta unggahan kertas kerja privat.
  - `PackageAuditFindingsSection`: Bagian terintegrasi pada `ReportPackageForm` saat melihat paket beku (`FROZEN`) untuk memeriksa temuan terkait paket tersebut.

## Pengujian yang Dijalankan

### 1. Backend Integration Tests (`backend/test/report_audit_findings_api.test.ts`)
Total: **7 pass, 0 fail**, dengan 100 assertion `expect()`.
- `rejects reader account attempting to record an auditor finding (AC11)`: Verifikasi penolakan keanggotaan READER.
- `validates finding inputs and missing fields`: Validasi masukan judul, deskripsi, lingkup, dan tingkat keparahan yang sah.
- `creates auditor finding bound to exact report version and package identity`: Pencatatan temuan terikat digest dan versi laporan.
- `completes full lifecycle: finding -> amil response -> auditor follow-up -> closure (AC21, AC28)`: Verifikasi alur lengkap siklus temuan, penolakan amil tanpa mandat, penolakan amil yang mencoba menutup sendiri temuan (403), tindak lanjut klarifikasi, hingga penutupan resmi oleh auditor.
- `enforces tenant isolation: Lembaga B cannot view or mutate findings of Lembaga A (AC11, AC29)`: Verifikasi pencegahan kebocoran lintas lembaga (404).
- `preserves owner-only working paper privacy while permitting examination downloads (AC23)`: Verifikasi perlindungan berkas kertas kerja privat (403 bagi amil) dan ketersediaan berkas klarifikasi timbal balik.
- `preserves public summary isolation: public endpoints never leak audit findings or private locators (AC30)`: Verifikasi isolasi ringkasan publik dan proteksi autentikasi 401 bagi pemanggil anonim.

### 2. Frontend Unit Tests (`frontend/src/features/workspace/auditFindingClient.test.ts`)
Total: **6 pass, 0 fail**, dengan 24 assertion `expect()`.
- Pengambilan antrean temuan (`fetchAuditQueues`).
- Pengambilan temuan terikat paket (`fetchPackageAuditFindings`).
- Pembuatan temuan baru (`createAuditFinding`).
- Pengiriman tanggapan amil (`submitAmilFindingResponse`).
- Pengiriman keputusan tindak lanjut auditor (`submitAuditorFindingFollowup`).
- Pengunduhan biner berkas lampiran (`downloadAuditAttachment`).

### 3. Frontend Full Build & Suite
- `bun test` di `frontend/`: **205 pass, 0 fail** (22 file tes).
- `bun run build` di `frontend/`: Sukses build Vite + SSR + Nitro tanpa error (kode keluar 0).
