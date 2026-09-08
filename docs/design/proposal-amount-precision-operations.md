# Jumlah eksak penyaluran USDC — #80

Kode menyimpan integer desimal pada `disbursement_proposals.amount_exact` (TEXT).
`currency_type` menentukan unit: 0 = IDR, 1 = satuan minor USDC 6 desimal.
Kolom lama memakai `-1` untuk jumlah baru di atas batas integer aman JavaScript;
jumlah sebenarnya tetap tersedia di kolom eksak. Pembaca laporan memakai kolom eksak.

## Sebelum migrasi

Dari `backend`, jalankan `bun run proposal:verify` dengan `DATABASE_URL` target.
Perintah ini hanya membaca katalog dan proposal. Pastikan target benar tanpa
mencetak URL/kredensial. Buat backup PostgreSQL menggunakan prosedur operator yang
sudah digunakan pada #67, simpan di luar Git, dan periksa backup dapat dibaca.

Migrasi produksi memerlukan persetujuan tersendiri sesuai cakupan issue #80.
Perubahan yang disetujui hanya:

```sql
ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS amount_exact TEXT;
```

## Migrasi dan verifikasi

1. Jalankan `bun run proposal:migrate` setelah persetujuan operator. Skrip menjalankan
   DDL aditif dan laporan verifikasi; aman diulang bila kolom sudah ada.
2. Restart proses backend setelah migrasi: hasil pemeriksaan katalog disimpan
   dalam cache proses. Tidak ada migrasi yang dijalankan otomatis saat boot.
3. Jalankan `bun run proposal:verify` lagi. `migrated` harus benar; jumlah proposal
   tidak berubah. Proposal lama tetap mempunyai `amount_exact = NULL`.
4. Konfirmasi proposal melalui jalur receipt yang sudah ada; periksa nilai eksak,
   tampilan USDC, rekonsiliasi internal, dan angka periode. Gunakan jaringan uji
   untuk transaksi sintetis; migrasi tidak mengirim transaksi.

Sebelum migrasi, pembacaan tetap berjalan dan konfirmasi jumlah kecil tetap dapat
disimpan. USDC tanpa jumlah eksak dilaporkan **belum terverifikasi**. Konfirmasi
jumlah besar ditolak sebelum penulisan, dengan alasan memerlukan migrasi.

## Pemulihan jumlah proposal lama

Tidak ada backfill berdasarkan angka lama. Pilih receipt transaksi yang telah
berhasil untuk ID proposal yang sama pada kontrak aktif. Kirim ulang ke
`POST /api/governance/confirm` dengan `action`, `txHash`, dan `proposalId` yang
sesuai; metadata opsional tetap memerlukan tanda tangan pengirim.

Jalur ini memverifikasi chain, kontrak, event, identitas proposal, state terkini,
dan blok canonical sebelum upsert. Ia menyimpan jumlah state chain yang eksak.
Pengulangan tidak menambah baris; konflik identitas penerima ditolak. Gunakan
receipt eksekusi untuk memulihkan waktu eksekusi; receipt pengajuan tidak
membuktikan waktu eksekusi. Bila bukti tidak tersedia, pertahankan status belum
terverifikasi. PGlite menguji upsert/pemulihan dan idempotensi, pengujian governance
menguji decoder receipt, sedangkan `app.fetch` menguji serialisasi dan replay.
Tidak satu pun pengujian tersebut merupakan observasi RPC produksi.

## Pemulihan kegagalan

Bila DDL gagal, periksa katalog lewat `proposal:verify` sebelum mengulang.
Tidak ada perubahan data lama yang harus dibalik. Jangan menghapus kolom eksak
untuk rollback: itu akan menghilangkan satu-satunya jumlah sah pada baris besar.
Jangan mengembalikan pembaca lama yang menganggap sentinel `-1` sebagai jumlah.
Hentikan penulisan konfirmasi bila perlu, lalu perbaiki dengan versi yang tetap
memahami kolom eksak. Pemulihan backup adalah tindakan operator tersendiri karena
dapat membuang penulisan setelah backup.
