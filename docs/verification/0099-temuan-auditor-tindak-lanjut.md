# Verifikasi Temuan Auditor, Tanggapan Amil, dan Tindak Lanjut Pemeriksaan — #99

Acuan: issue #99, spec #86 (US-03, US-51–59, skenario 11, 20–25), amandemen pilot #100 (AC15, AC19, AC23, AC24, AC26, AC28, AC29, AC30), ADR-0022.

Catatan ini menggantikan verifikasi `20a72c2`. Code review atas commit itu menemukan fallback kewenangan auditor tanpa registry, status yang di-`UPDATE`, tidak adanya transaksi/idempotensi/penugasan, kebocoran lampiran ke READER, dan smoke browser yang belum dijalankan. Semuanya diperbaiki di bawah ini.

## Perilaku

- **Ikatan versi.** Temuan hanya dicatat pada paket `FROZEN` yang dibaca melalui `createReportPackages().read` (commitment digest diverifikasi). Klien mengirim `packageDigest` yang ditinjau; digest berbeda → 409. `reportId`/`version` diambil dari paket; paket tanpa keduanya → 409 (tidak ada nilai default).
- **Kewenangan auditor = mandat registry.** `auditorAuthority` pada ReportEvidenceRegistry dibaca setiap penulisan. Tanpa registry → 503; tanpa mandat aktif → 403 (termasuk ADMIN, OFFICER, READER tanpa mandat). Keanggotaan READER dengan mandat registry dapat bertindak sebagai auditor. Pemegang mandat amil `HANDLE_REPORT_EXAMINATION` tidak dapat menjadi auditor pada pemeriksaan yang sama.
- **Penugasan dan serah terima.** Auditor yang ditugaskan diproyeksikan dari riwayat (awal: pencatat temuan). Hanya auditor tersebut, dengan mandat masih aktif, yang menetapkan tindak lanjut. Serah terima (`AUDITOR_HANDOVER`) memerlukan dasar penugasan: diserahkan oleh auditor yang ditugaskan kepada pemegang mandat lain, atau diambil alih setelah mandat auditor yang ditugaskan dicabut.
- **Append-only.** Tabel `audit_findings` (kepala tak berubah), `audit_finding_events` (unik `(finding_id, seq)`), `audit_finding_files`, `audit_finding_operations`. Tidak ada kolom status, `UPDATE`, `DELETE`, atau cascade. Status, penugasan dan koreksi catatan diproyeksikan dari riwayat. `NOTE_CORRECTION` menambah koreksi oleh penulis asli; catatan asli tetap terbaca.
- **Transisi.** `OPEN` → `DITANGGAPI` (tanggapan amil) → `DITINDAKLANJUTI` / `MENUNGGU_KOREKSI_LAPORAN` / `DITUTUP_AUDITOR`. Temuan tertutup tidak dapat ditanggapi, ditindaklanjuti ulang, atau diserahterimakan (409). Amil tidak dapat menutup (403).
- **Transaksi, konkurensi, idempotensi.** Setiap mutasi: klaim `operationId` + hash isi, kunci `FOR UPDATE` pada kepala temuan, cek `expectedRevision`, sisipkan event+berkas, dalam satu transaksi. Retry isi sama → hasil yang sama; id sama isi berbeda → 409; revisi usang → 409.
- **Akses baca.** Amil bermandat dan auditor bermandat membaca uraian lengkap; anggota lain (READER, ADMIN, OFFICER tanpa mandat) hanya status per versi (`STATUS_ONLY`). Lampiran `OWNER_ONLY` hanya untuk pengunggahnya (tidak untuk auditor pengganti), namanya tidak ditampilkan kepada pihak lain (hanya jumlah). Lampiran `EXAMINATION` untuk pengunggah, amil bermandat, dan auditor yang ditugaskan. Unduhan memeriksa ukuran + SHA-256; berkas rusak → 409, hilang → 404. Locator penyimpanan tidak pernah dikirim.
- **Rujukan operasional.** Pengajuan (dan versinya), realisasi, dokumen dan sengketa penerimaan divalidasi ada pada lembaga yang sama; penautan tidak mengubah realisasi/sengketa. Sertifikat/NFT tahap belum ada (#111), jadi belum dapat ditautkan.
- **Koreksi versi.** Detail temuan memuat daftar paket beku yang menyebut versi ini sebagai pendahulu. Saat `MENUNGGU_KOREKSI_LAPORAN`, UI menawarkan “Siapkan versi koreksi dari paket ini” yang membuka alur koreksi `ReportPackageForm` dengan pendahulu terisi. Temuan versi lama tidak diwariskan.
- **Batas klaim.** `AUDIT_CLAIM_BOUNDARIES` ditampilkan pada detail: proof ZK, NFT tahap, status versi, penyaluran dan opini audit dibedakan; tindak lanjut tidak menerbitkan atestasi onchain.
- **Hasil belum diketahui.** Kegagalan jaringan/5xx menampilkan “Hasilnya belum diketahui” dengan tombol muat ulang; kirim ulang isi yang sama memakai `operationId` yang sama sehingga tidak tercatat dua kali. Respons 500 server tidak membocorkan pesan internal.
- **Publik.** Tidak ada temuan dalam ringkasan publik.

## Pengujian

- `backend/test/report_audit_findings_api.test.ts`: **10 pass** (dengan smoke browser), registry ReportEvidenceRegistry nyata di Anvil lokal (grant/revoke/re-grant), PGlite, penyimpanan berkas terenkripsi, `reopen()` database. Mencakup: tanpa registry/tanpa mandat/ADMIN/READER, ikatan digest & paket DRAFT, rujukan realisasi+sengketa nyata dan fiktif, siklus lengkap + tidak dibuka kembali, retry/konflik/revisi usang, mandat dicabut + serah terima dua arah, koreksi catatan, owner-only setelah serah terima, berkas rusak, status-only untuk anggota lain, isolasi dua lembaga, ringkasan publik, durabilitas setelah restart.
- Smoke browser (Chromium, Playwright, viewport 390×844, sesi wallet sintetis nyata, submit via keyboard): auditor mencatat temuan → amil menanggapi; respons pertama sengaja diputus setelah server mencatat, UI menampilkan hasil belum diketahui, kirim ulang menghasilkan tepat 2 event → auditor menutup → READER melihat status “Ditutup auditor” untuk versi 1 tanpa uraian. Tanpa error halaman.
  `REGISTRY_BROWSER_MODULE=…/playwright-core@1.63.0@@@1/index.mjs REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium bun test test/report_audit_findings_api.test.ts`
- `backend`: `bun test` penuh — **957 pass, 22 skip, 0 fail** (74 file; smoke browser dilewati tanpa variabel Playwright dan dijalankan terpisah seperti di atas).
- `frontend`: `bun test` — **204 pass, 0 fail**; `auditFindingClient.test.ts` 5 pass. `bun run build` sukses.

## Tindak lanjut code review `8bd9402`

- **Dasar pergantian auditor tervalidasi.** `assignmentRef` tidak lagi diketik pengguna (field ditolak 400). Server mencatat mandat auditor penerima dari registry beserta epoch-nya (`<mandat> (epoch N)`), baik saat dialihkan maupun diambil alih; mandat kosong ditolak 409.
- **Status diproyeksikan dari jenis event.** `project()` menurunkan status dari `eventType`/`followupAction`; kolom `resulting_status` hanya rekaman hasil proyeksi yang sama.
- **Replay sebelum kewenangan.** Retry operasi yang sudah tercatat mengembalikan hasilnya walau mandat penulis telah berakhir; penulisan baru tetap 403.
- **Koreksi catatan pada temuan tertutup ditolak (409).**
- **Daftar temuan per versi dibatasi `preparationId` pada URL.**
- **Berkas dari penulisan yang gagal dihapus** (konflik revisi, temuan hilang), sehingga tidak ada blob terenkripsi yatim.
- Kerapian: daftar CHECK SQL dibentuk dari konstanta `shared/`, tipe input klien dipindah ke `shared/audit-findings.ts`, batas lampiran `AUDIT_ATTACHMENT_MAX_BYTES` dipakai bersama, `FOLLOWUP_RESULT` → `STATUS_AFTER_FOLLOWUP`, istilah "serah terima" diganti "pergantian auditor" (glosarium `CONTEXT.md`).
- Tidak diubah, karena sudah diputuskan di tempat lain:
  - **Mandat auditor se-lembaga.** #76 meminta kewenangan auditor "untuk scope lembaga yang eksplisit" pada registry, dan `docs/design/report-attestation-v1.md` mencatat `setAuditor(institutionId, auditor, active, mandate)` tanpa lingkup per pemeriksaan. Sama dengan `report-attestation.ts`. Mandat per pemeriksaan memerlukan tiket dan perubahan registry tersendiri.
  - **Pemegang mandat amil `HANDLE_REPORT_EXAMINATION` tidak dapat menjadi auditor.** Turunan dari ADR-0006 (auditor independen tanpa konflik kepentingan), ADR-0028 ("pemisahan auditor setelah kegiatan tetap berlaku") dan riset 0007 (pemisahan penyusun/pengesah/auditor sudah diputuskan).
  - **Pengambilalihan setelah mandat auditor yang ditugaskan dicabut.** #86 mensyaratkan "mandat/penugasan yang tercatat", kini dipenuhi mandat registry penerima; #77 menetapkan "tindakan baru memakai kewenangan terkini sementara publikasi lama tetap dapat diperiksa".
- Belum tercakup: uji integrasi tindak lanjut temuan hingga atestasi atau versi koreksi di EVM lokal. Hanya grant/revoke/re-grant registry yang berjalan di Anvil; atestasi tetap diuji di `auditor_attestation.test.ts` (#76). Sisa ini dibawa ke gerbang rilis #115.

Pengujian ulang: `report_audit_findings_api.test.ts` **12 pass** dengan smoke browser; `bun test` backend penuh **959 pass, 22 skip, 0 fail**; frontend **204 pass**, `bun run build` sukses.

## Catatan deployment

Tabel lama `report_audit_findings`, `report_audit_finding_events`, `report_audit_finding_attachments` dari `20a72c2` tidak lagi dibuat atau dibaca. Basis data yang sempat menjalankan versi itu masih menyimpannya; tabel tersebut dapat dihapus manual setelah dipastikan kosong.
