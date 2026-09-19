# Issue #106 — Koreksi kontribusi dan pencatatan pengembalian

Issue: https://github.com/tawf-labs/tawf-zakat/issues/106. Induk: spec #100 (US-40, US-41, US-42, US-44, US-45, US-91; AC03, AC04, AC10, AC11, AC12, AC15, AC19, AC29).

## Cakupan & Aturan Bisnis

1. **Pengesahan & Jejak Versi Koreksi (US-40, US-41, AC19)**:
   - Koreksi nominal atau status kontribusi memerlukan mandat `ENDORSE_CONTRIBUTIONS`, alasan tertulis, referensi bukti sumber (mutasi/rekening koran), dan versi pendahulu (`expectedVersion`). Mandat pencatatan saja tidak cukup. Koreksi atas kontribusi `ENDORSED` mencatat pengesah, mandat, waktu, dan dasar koreksi terbaru; pengesahan sebelumnya tetap ada dalam riwayat.
   - Data historis tidak ditimpa secara diam-diam. Setiap koreksi menaikkan nomor versi kontribusi (`version`), mencatat riwayat perubahan pada tabel `contribution_corrections` dan `contribution_events`.
   - API menampilkan `NOT_AVAILABLE` selama belum ada binding receipt/proof pilot yang tersimpan. Parameter `proofVersion` dari pemanggil tidak menentukan keberlakuan. Pembandingan versi tepercaya membedakan versi lama (`SUPERSEDED`), cocok (`CURRENT`), dan versi tidak sah/tidak tersedia (`NOT_AVAILABLE`). Integrasi receipt/proof nyata tetap cakupan #108/#110.

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
   - Koreksi pencatatan ganda (`DUPLICATE`) mengubah status menjadi `REJECTED` dan menolkan kapasitas pendanaannya; nominal historis tetap disimpan. Alokasi lama menjadi selisih, tanpa entri refund atau arus kas keluar. Keputusan refund baru atas catatan yang ditolak juga ditolak.
   - ZKT tidak menyediakan payout bank otomatis; seluruh penyelesaian finansial dilakukan di luar rantai melalui kanal resmi lembaga dan dicatatkan buktinya.
   - Sisa kegiatan penyaluran yang ditutup tidak otomatis dialokasikan ulang atau direfund (AC11).

5. **Privasi & Penegakan Otorisasi (AC15, AC29)**:
   - Peringatan selisih memperjelas pihak yang harus bertindak (pejabat operasional lembaga).
   - Rincian donor dan nominal tetap berada dalam ranah privat internal lembaga dan tidak diekspos ke publik.
   - Isolasi antar-lembaga ditegakkan ketat: amil lembaga lain menerima 404 / 403 saat mengakses data kontribusi, koreksi, maupun refund lembaga lain.

## Verifikasi Pengujian

Suite pengujian terisolasi `backend/test/contribution_correction_api.test.ts` memverifikasi skenario di bawah melalui HTTP Hono nyata, database PGlite terisolasi, enkripsi berkas, dan otentikasi signature EIP-712:

- **US-41 & AC10**: Koreksi nominal menaikkan versi dari V1 ke V2, mencatat record koreksi dengan alasan dan bukti sumber, serta mempertahankan versi lama.
- **Stale Version & Mandate Gate**: Penolakan koreksi dengan `expectedVersion` usang, alasan kosong, atau role tanpa mandat operasional.
- **AC10 & ADR-0033 Q28**: Kontribusi 500k dialokasikan 450k ke kegiatan, dikoreksi menjadi 400k. Selisih 50k dimunculkan, penyaluran aktual tetap ada, dan alokasi tambahan 1k ditolak atomik karena melebihi kapasitas kontribusi.
- **AC12 & AC04**: Koreksi duplikat (`DUPLICATE`) tidak memicu entri pengembalian dana atau pembayaran riil.
- **AC03 & US-44**: Siklus refund 2 tahap terpisah (`DECIDED` lalu `PAID`). Retry pembayaran idempoten sukses mengembalikan status yang sama tanpa double payment. Pembayaran kedua pada refund yang sudah lunas ditolak 400/409.
- **AC19**: Versi dari query (termasuk versi sekarang, masa depan, dan teks tidak sah) tidak menghasilkan proof berlaku. Pembandingan versi tepercaya diuji terpisah, tanpa mengklaim propagasi receipt/chain selesai.
- **AC29 & Durabilitas**: Database ditutup dan dibuka kembali dengan `database.reopen()`. Seluruh koreksi, refund, selisih, dan peristiwa versi tetap utuh, dan isolasi antar-lembaga terbukti aman (Lembaga B tidak dapat melihat kontribusi Lembaga A).

## Perbaikan Review

- Retry pembayaran tanpa `paidAt` mengikat hash pada input permintaan, bukan waktu server yang berubah. Hasil pertama tetap diputar ulang setelah waktu maju dan storage dibuka ulang; isi berbeda dengan operationId sama ditolak. Waktu eksplisit yang tidak sah ditolak. Form UI menyediakan waktu pembayaran aktual.
- `shared/contribution-lifecycle.ts` menjadi kontrak bersama untuk koreksi, pengembalian, event dan keberlakuan proof. Detail UI memakai respons API langsung, termasuk `contribution.proofValidity`, `actorAccount`, dan `createdAt`.
- Endpoint donatur mengembalikan versi serta riwayat nominal/alasan/waktu untuk kontribusi dalam sesinya. Proyeksi tidak menyertakan referensi dokumen internal atau identitas operator; akses silang dan tanpa sesi ditolak. Detail dan riwayat dibaca dalam satu pernyataan SQL.
- Modal dipecah menjadi bagian formulir, riwayat dan dokumen di bawah 150 baris per komponen. Kode acceptance criteria dan jargon idempotensi dihapus dari tampilan utama.
- Ketiga form memakai `operationFor` dan `settle` dari helper yang tersedia; pemanggilan `mint` yang tidak ada dihapus. Bukti sumber koreksi ditandai wajib. Keputusan refund membedakan batas nominal kontribusi dari sisa alokasi, sesuai validasi API.

## Verifikasi UI dan TypeScript (2026-09-20)

Browser smoke dijalankan memakai Chromium headless lokal dengan data sintetis, sesi berotorisasi, HTTP aplikasi, dan database PGlite terisolasi. Tidak memakai akun atau transaksi produksi.

Dari `backend/`, atur modul Playwright lokal dan executable Chromium:

```bash
REGISTRY_BROWSER_MODULE="$LOCAL_PLAYWRIGHT_MODULE" \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/contribution_correction_api.test.ts test/contribution_api.test.ts test/activity_allocation_api.test.ts test/donor_otp_access_api.test.ts test/donor_recovery_api.test.ts
```

Tanpa `REGISTRY_BROWSER_MODULE`, browser smoke tetap opt-in. Verifikasi kali ini mengaktifkan semuanya, termasuk test baru #106.

Cakupan browser #106 pada viewport 1280×900 dan 390×844:

- Buka detail, tampilkan status bukti belum tersedia, lalu buka koreksi melalui keyboard.
- Wajibkan bukti sumber sebelum submit. Koreksi 500.000 → 400.000 atas alokasi 450.000 menampilkan selisih 50.000, riwayat dan waktu koreksi yang sah.
- Catat keputusan pengembalian 100.000 sebagai menunggu pembayaran, lalu masukkan bukti dan waktu pembayaran aktual.
- Putuskan respons setelah server menyimpan pembayaran. Pesan gagal tetap terlihat di modal; retry mengirim payload dan operationId yang sama, mengembalikan hasil, dan hanya menghasilkan satu event pembayaran.
- Muat ulang halaman: bukti pembayaran, riwayat, dan selisih 150.000 tetap terlihat. Pencatat tanpa mandat pengesahan tidak mendapat tombol koreksi.
- Periksa lebar halaman dan isi modal agar tidak meluber pada ponsel. Tab dapat digeser; filter, lampiran, alokasi dan riwayat menyesuaikan lebar layar.

Temuan browser yang diperbaiki: pesan gagal sebelumnya tertutup modal; filter dan isi detail tertentu melebar pada ponsel. Logger smoke #103 juga diperbaiki agar tidak memulai pembacaan body respons saat halaman sudah ditutup, penyebab kegagalan tes yang tidak konsisten.

TypeScript lama dibereskan tanpa melonggarkan `strict` atau menambahkan suppression: import/variabel tidak terpakai dihapus, badge memakai varian yang tersedia, dan animasi Globe memakai API `update()` COBE v2 dengan pembersihan animation frame saat unmount. `frontend/package.json` menyediakan `bun run typecheck`.

Dari `frontend/`:

```bash
bun run typecheck
bun test
bun run build
```

Hasil akhir:

- `bun run typecheck`: **lulus, 0 error**, konfigurasi strict tetap aktif.
- Seluruh tes frontend: **214 pass, 0 fail**, 605 assertions pada 24 file.
- Suite backend terkait: **74 pass, 0 fail, 0 skip**, 852 assertions pada lima file, termasuk **lima smoke browser** (#102–#106).
- `bun run build` frontend: berhasil. Build backend pada perbaikan sebelumnya juga berhasil; perubahan backend pada tindak lanjut ini hanya pada harness tes.
- `git diff --check`: bersih.
- Tangkapan layar verifikasi lokal: `/tmp/issue106-browser-1280.png` dan `/tmp/issue106-browser-390.png`. Keduanya diperiksa, dan tes juga memeriksa batas lebar halaman/modal.

Bukti chain/reproof dan pembayaran bank tetap di luar klaim pengujian ini.
