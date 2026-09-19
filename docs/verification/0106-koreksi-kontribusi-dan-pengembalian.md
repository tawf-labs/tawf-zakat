# Issue #106 — Koreksi kontribusi dan pencatatan pengembalian

Issue: https://github.com/tawf-labs/tawf-zakat/issues/106. Induk: spec #100 (US-40, US-41, US-42, US-44, US-45, US-91; AC03, AC04, AC10, AC11, AC12, AC15, AC19, AC29).

## Cakupan & Aturan Bisnis

1. **Pengesahan & Jejak Versi Koreksi (US-40, US-41, AC19)**:
   - Koreksi nominal atau status kontribusi disahkan oleh pihak berwenang dengan alasan tertulis, referensi bukti sumber (mutasi/rekening koran), dan versi pendahulu (`expectedVersion`).
   - Data historis tidak ditimpa secara diam-diam. Setiap koreksi menaikkan nomor versi kontribusi (`version`), mencatat riwayat perubahan pada tabel `contribution_corrections` dan `contribution_events`.
   - Proof atau bukti audit yang merujuk pada versi bisnis lama dilabeli `SUPERSEDED` dan tidak dilabeli `CURRENT` (AC19).

2. **Perlindungan Penyaluran & Selisih Lebih Alokasi (US-42, AC10, ADR-0033 Q28)**:
   - Skenario pengujian: Kontribusi Rp 500.000 dialokasikan Rp 450.000 ke kegiatan penyaluran, kemudian dikoreksi menjadi Rp 400.000.
   - Penyaluran aktual yang sudah disalurkan kepada mustahik dipertahankan secara utuh (tidak ditimpa/dibatalkan sepihak).
   - Terjadi selisih lebih alokasi (*shortfall*) sebesar Rp 50.000. Selisih ini ditampilkan secara transparan di UI.
   - Setiap permintaan alokasi baru yang memperburuk selisih ditolak secara atomik oleh sistem (`shortfallAmount > 0` memblokir alokasi baru melebihi saldo bersih tersedia).

3. **Pemisahan Siklus Pengembalian 2 Tahap (US-44, AC03, AC12)**:
   - Tahap 1 — Keputusan Pengembalian (`DECIDED`): Dicatat dengan identitas keputusan, versi kontribusi, nominal, alasan, dan dasar kebijakan syariah lembaga (`policyBasis`).
   - Tahap 2 — Realisasi Pembayaran Riil (`PAID`): Memiliki identitas transaksi, bukti bayar transfer bank (`paymentProofRef`), stempel waktu riil, dan catatan pembayaran tersendiri.
   - Idempoten: Percobaan ulang (*retry*) transaksi dengan `operationId` yang sama mengembalikan hasil identik tanpa mencatat arus kas kembali dua kali.

4. **Pembedaan Tegas Tanpa Payout Otomatis (US-45, AC04, AC12)**:
   - Koreksi pencatatan ganda (`DUPLICATE`) menolkan kontribusi yang salah rekam tanpa memicu pengembalian dana (refund) atau arus kas keluar.
   - ZKT tidak menyediakan payout bank otomatis; seluruh penyelesaian finansial dilakukan di luar rantai melalui kanal resmi lembaga dan dicatatkan buktinya.
   - Sisa kegiatan penyaluran yang ditutup tidak otomatis dialokasikan ulang atau direfund (AC11).

5. **Privasi & Penegakan Otorisasi (AC15, AC29)**:
   - Peringatan selisih memperjelas pihak yang harus bertindak (pejabat operasional lembaga).
   - Rincian donor dan nominal tetap berada dalam ranah privat internal lembaga dan tidak diekspos ke publik.
   - Isolasi antar-lembaga ditegakkan ketat: amil lembaga lain menerima 404 / 403 saat mengakses data kontribusi, koreksi, maupun refund lembaga lain.

## Verifikasi Pengujian

Suite pengujian terisolasi `backend/test/contribution_correction_api.test.ts` memverifikasi seluruh skenario penerimaan melalui HTTP Hono nyata, database PGlite terisolasi, enkripsi berkas, dan otentikasi signature EIP-712:

- **US-41 & AC10**: Koreksi nominal menaikkan versi dari V1 ke V2, mencatat record koreksi dengan alasan dan bukti sumber, serta mempertahankan versi lama.
- **Stale Version & Mandate Gate**: Penolakan koreksi dengan `expectedVersion` usang, alasan kosong, atau role tanpa mandat operasional.
- **AC10 & ADR-0033 Q28**: Kontribusi 500k dialokasikan 450k ke kegiatan, dikoreksi menjadi 400k. Selisih 50k dimunculkan, penyaluran aktual tetap ada, dan alokasi tambahan 1k ditolak atomik karena melebihi kapasitas kontribusi.
- **AC12 & AC04**: Koreksi duplikat (`DUPLICATE`) tidak memicu entri pengembalian dana atau pembayaran riil.
- **AC03 & US-44**: Siklus refund 2 tahap terpisah (`DECIDED` lalu `PAID`). Retry pembayaran idempoten sukses mengembalikan status yang sama tanpa double payment. Pembayaran kedua pada refund yang sudah lunas ditolak 400/409.
- **AC19**: Proof yang merujuk versi sebelum koreksi dilabeli `SUPERSEDED` dan tidak dilabeli `CURRENT`.
- **AC29 & Durabilitas**: Database ditutup dan dibuka kembali dengan `database.reopen()`. Seluruh koreksi, refund, selisih, dan peristiwa versi tetap utuh, dan isolasi antar-lembaga terbukti aman (Lembaga B tidak dapat melihat kontribusi Lembaga A).

Eksekusi pengujian:
```bash
bun test test/contribution_correction_api.test.ts test/contribution_api.test.ts test/activity_allocation_api.test.ts
```

## Hasil Eksekusi

- `test/contribution_correction_api.test.ts`: **7 pass, 0 fail, 86 assertions**.
- `test/contribution_api.test.ts`: **16 pass, 0 fail, 169 assertions** (1 browser smoke skipped).
- `test/activity_allocation_api.test.ts`: **13 pass, 0 fail, 222 assertions** (1 browser smoke skipped).
- `bun run build` pada backend dan frontend: **Lulus 100% tanpa error**.
