# Snapshot sumber: penggunaan dan penyimpanan (#70)

Petugas atau administrator lembaga dapat membuka ruang kerja, memasukkan dua sisi ledger JSON beserta manifest, lalu memilih **Bekukan, rekonsiliasi, dan simpan**. Contoh JSON sintetis tersedia di masing-masing editor. Unggahan JSON juga dipertahankan sebagai lampiran asli; lampiran dapat diganti atau dilepas sebelum disimpan. Form menampilkan sisi, nomor baris (mulai dari 1), field, dan alasan jika server menolak masukan.

Jumlah adalah teks integer: `"1500000"` berarti Rp1.500.000 untuk IDR atau 1,5 USDC untuk `USDC_6DP`. Periode dan unit pada kedua manifest harus cocok dengan persiapan. Baris menyimpan `key`, `bucket`, `balanceSheet`, dan `value: { amount, unit }`; `amilAmount` dan `label` opsional. Total deklarasi disertakan pada `declaredTotals`, terpisah dari `rows`. JSON adalah format input terstruktur rilis ini; lampiran CSV/PDF tidak otomatis diparse menjadi ledger. Kompatibilitas ekspor SiMBA belum diuji.

`READ` dengan `rows: []` berarti sumber berhasil dibaca dan kosong. `MISSING`/`FAILED` wajib membawa `detail` alasan dan tidak membawa baris. Rekap dinyatakan dengan `transactionDetail: "NOT_AVAILABLE"`. Sumber yang tidak terbaca menghasilkan persiapan `INCOMPLETE` tanpa hasil rekonsiliasi. Selisih pada sumber yang terbaca tetap disimpan sebagai temuan. Reader database lama sudah memiliki boundary yang membedakan ketiga keadaan ini; snapshot baru menerima ledger terstruktur, belum menyediakan impor langsung dari database aktif.

Sesudah disimpan, buka persiapan pada daftar untuk melihat manifest, baris normalisasi, hasil, temuan, batas pemeriksaan, dan lampiran. **Muat ulang** membaca ulang snapshot yang tersimpan. Mengubah editor atau membuat persiapan berikutnya tidak mengubah snapshot terdahulu. Pembaca berwenang dapat membaca dan mengunduh, tetapi tidak dapat membuat persiapan baru.

## Konfigurasi lokal dan deployment

- `DATABASE_URL`: PostgreSQL privat untuk keanggotaan, sesi, dan persiapan. Startup membuat tabel `evidence_preparations`, `evidence_sources`, `evidence_findings`, dan `evidence_files` secara aditif dan idempoten. Tidak ada backfill atau perubahan kepemilikan data lama. Semua isi persiapan ditulis dalam satu transaksi.
- `EVIDENCE_FILE_KEY`: 32 byte acak, ditulis sebagai 64 karakter heksadesimal, disimpan di secret manager. Jangan gunakan kunci fixture demo. Kunci tidak pernah dikirim ke frontend. Tanpa kunci, snapshot tetap dapat dibuat tetapi lampiran berstatus `FAILED` dan tidak disimpan.
- `EVIDENCE_FILE_DIR`: volume privat yang bertahan setelah restart, di luar direktori publik frontend/web server. Default `.evidence-files` diabaikan Git. Lampiran dienkripsi AES-256-GCM dengan nonce baru per berkas. API menerima maksimal 10 MiB per berkas; form membatasi 5 MiB per berkas.
- Gunakan HTTPS untuk browser/API dan koneksi PostgreSQL terlindungi pada deployment. Database menyimpan manifest, baris sumber, dan salt terbatas; enkripsi lampiran tidak mengenkripsi kolom database. Akses database, backup, volume, dan secret manager harus dibatasi kepada operator berwenang.

Sebelum data pribadi mitra digunakan, onboarding harus menetapkan pemilik penyimpanan, akses operator, masa retensi, jadwal backup, target pemulihan, dan prosedur pemulihan kunci. Rilis ini tidak menghapus sumber secara otomatis dan tidak menjalankan migrasi produksi.

Backup mencakup PostgreSQL, volume ciphertext, dan kunci yang sesuai (disimpan terpisah dari backup data). Pulihkan ketiganya bersama pada lingkungan terisolasi, jalankan `bun run demo:evidence` untuk pemeriksaan instalasi terpisah, kemudian periksa persiapan hasil pemulihan melalui API: commitment cocok dan lampiran terbaca oleh sesi berwenang. Mengganti kunci tanpa migrasi ciphertext membuat berkas lama tidak dapat dibuka. Rotasi/enkripsi ulang kunci belum disediakan.

Jika penyimpanan database gagal, transaksi dibatalkan. Ciphertext yang sudah ditulis dapat tertinggal tanpa referensi persiapan; tidak tersedia melalui API. Jangan menghapus volume untuk rollback aplikasi. Simpan backup sebelum rollout; rollback kode dapat membiarkan tabel tambahan dan volume tetap ada untuk pemulihan berikutnya.

## Permukaan API

| Endpoint | Akses dan hasil |
| --- | --- |
| `POST /api/evidence` | Sesi petugas/admin; bekukan, rekonsiliasi, simpan |
| `GET /api/evidence` | Sesi berwenang; daftar persiapan lembaganya |
| `GET /api/evidence/:id` | Sesi berwenang; snapshot, hasil, salt, status verifikasi commitment |
| `GET /api/evidence/:id/files/:fileId` | Sesi berwenang; berkas asli atau alasan tidak tersedia |
| `GET /api/evidence/:id/public` | Ringkasan tersaring; tidak membawa teks bebas sumber, baris, nama berkas, salt, atau locator |

Commitment adalah HMAC-SHA256 atas JSON kanonik snapshot versi 1, dengan salt 32 byte per persiapan. Kunci objek diurutkan; urutan array dipertahankan; jumlah uang berupa teks desimal. Pembaca berwenang dapat mengkanonikalisasi `snapshot`, menghitung HMAC dengan `commitmentSalt`, lalu mencocokkan `commitment`. SHA-256 berkas asli hanya tersedia bagi pembaca berwenang. Ringkasan publik memiliki SHA-256 sendiri (`summaryDigest`) atas JSON kanonik tanpa field digest tersebut.

Ringkasan hanya membawa identitas lembaga/persiapan, periode, kategori/cut-off sumber, hasil agregat, jumlah temuan, dan batas pemeriksaan dengan teks yang dibentuk dari enum tervalidasi. Label bebas, unit sumber bebas, nama berkas, catatan, dan pesan kegagalan privat tidak disalin ke ringkasan.

Persiapan bukti bukan laporan terbit. Registry, pengesahan lembaga/validator, koreksi versi, serta atestasi auditor berada pada tiket berikutnya.

## Demo yang dapat diulang

Dari `backend`, jalankan `bun run demo:evidence`. Script memakai PGlite dan volume berkas sementara terisolasi, serta fixture lembaga sintetis. Adapter deployment dinonaktifkan sebelum app diimpor.

Hasil yang diharapkan: selisih awal Rp300.000.000; persiapan berikutnya memakai angka terkoreksi dengan selisih Rp0; membuka ulang persiapan awal tetap Rp300.000.000 dengan commitment cocok. Unduhan berkas tanpa sesi menjawab HTTP 401. Tes HTTP juga menutup dan membuka ulang database untuk membuktikan snapshot bertahan setelah restart.
