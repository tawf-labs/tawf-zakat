# Ringkasan publik dan pemeriksaan lokal — #74

Dasar: spec #68 stories 32–43 yang tercakup tiket #74, ADR-0020–0022. Halaman `/transparansi/laporan?packageId=<UUID>`, HTTP publik `/api/public/reports/:packageId`, ekspor terbatas `/api/evidence/:preparationId/reports/:packageId/examination`.

## Pemisahan publik dan privat

Ringkasan baru hanya tersedia setelah penerbitan aplikasi terkonfirmasi dengan receipt/event dan versi registry yang cocok. Pembacaan pertama menyimpan proyeksi immutable di tabel tambahan `public_report_summaries`, ber-FK ke paket. Draf tidak dipublikasikan. Proyeksi tetap dapat dibaca setelah reorg, dengan status penerbitan yang ditarik dan referensi anchor sebelumnya. RPC gagal menghasilkan 503; UI menghapus klaim keberhasilan yang tidak dapat diperiksa. Polling empat detik, tanpa tumpang tindih.

Konten statis menyebut lembaga dari konfigurasi onboarding, periode, unit/jenis dana/posisi neraca, tingkat cakupan yang dikenal, referensi versi/paket, commitment, kebijakan, hitungan temuan dan selisih agregat. Asal sumber, cut-off, dan ketersediaan rincian transaksi ditampilkan dari field terstruktur. Sumber rekap menyertakan `TRANSACTION_DETAIL_UNAVAILABLE`: kecocokan total tidak membuktikan pembayaran individual. Tingkat cakupan bebas diganti `CAKUPAN_TERBATAS`. Judul/nomor versi bebas, narasi, label baris, nama berkas, SHA plaintext sumber, catatan bebas, salt, key dan lokasi penyimpanan tidak disalin. Referensi laporan/versi berupa key hash registry. Identitas asli yang dikirim #73 ke kontrak memang calldata publik: onboarding harus memakai identitas laporan yang layak publik; hash referensi tidak diklaim melindungi identitas mustahik.

Digest ringkasan adalah SHA-256 atas `canonicalJson(summary.content)`. Status dinamis terpisah: pencatatan bukti, vonis validator, penerbitan, ketersediaan berkas dan auditor. LOLOS tetap menampilkan selisih. Nama jaringan, chain ID, registry, hash/nomor blok, log, transaksi dan kebijakan konfirmasi tersedia; kedalaman blok bukan finalitas settlement L1. Tautan explorer hanya untuk deployment yang dikenal.

Setiap pengambilan privat memeriksa bearer session dan keanggotaan aktif lagi. Token query tidak diterima. Respons evidence memakai `private, no-store` (berkas `no-store`) dan `Vary: Authorization`; ekspor juga `nosniff`. Unduhan draf membaca ulang paket melalui API dan berlabel belum diterbitkan. Ekspor pemeriksaan membawa status publikasi saat pengambilan. Revokasi menghentikan pengambilan berikutnya, bukan menghapus salinan yang telah diunduh.

## Ekspor dan runner

`examination.json` berisi canonical JSON paket/snapshot, kedua commitment dan salt terbatas, byte berkas base64 atau status hilang, kedua pengesahan, receipt/event dan checkpoint. Tidak berisi private key, raw transaksi relayer atau locator penyimpanan. Paket ini privat dan tidak boleh dipublikasikan.

Dengan Bun dan dependency proyek terpasang:

```sh
bun backend/src/scripts/verify-report.ts examination.json
bun backend/src/scripts/verify-report.ts examination.json --rpc http://127.0.0.1:8545 --chain-id 31337 --registry ALAMAT_REGISTRY
```

Ganti placeholder dengan alamat yang diperoleh independen. Runner tidak mengambil URL RPC dari ekspor dan tidak memanggil AI. Simpan commit sumber bersama ekspor agar aturan v1 dapat dijalankan setelah kode berkembang.

Runner memeriksa serialisasi, commitment, identitas, byte/hash/ukuran berkas, versi kebijakan, angka integer presisi, rekonsiliasi, klaim/narasi/disclosure dan vonis dengan mesin murni proyek. Signature EOA diperiksa kriptografis; event ekspor harus mengikat paket/otorisasi yang sama. Perubahan berkas, angka, aturan, atau signature menghasilkan kegagalan.

Offline menyatakan `NOT_CHECKED_OFFLINE` untuk chain: konsistensi ekspor bukan bukti canonical chain atau mandat historis. Mode RPC membutuhkan chain ID dan registry independen, membaca receipt dan blok canonical, serta membandingkan signature/otorisasi dengan versi yang diterima registry. ERC-1271 membutuhkan RPC; penerimaan historis diperiksa dari registry/transaksi sukses, bukan role wallet saat ini. RPC arsip mungkin diperlukan. Konfirmasi ekspor merupakan checkpoint waktunya; pemeriksaan canonical receipt bukan janji settlement L1.

Exit 0 berarti pemeriksaan integritas/perhitungan dan signature yang tersedia berhasil, dengan batas chain tetap dinyatakan. Exit 1 berarti integritas/aturan/signature/anchor gagal. Exit 2 berarti sumber tidak lengkap atau signature akun kontrak membutuhkan RPC. Berkas yang hilang tidak diganti sumber terbaru dan tidak menghapus sejarah penerimaan.

## Skema dan batas cakupan

`ensureSchema` menambahkan tabel ringkasan/FK tanpa mengubah paket lama. Backup bersama evidence, registry intents/attempts dan ciphertext/kunci. Tabel proyeksi tidak mengandung secret. Proyeksi dapat dibangun kembali untuk penerbitan yang masih canonical; proyeksi anchor orphaned memerlukan backup agar riwayat publik tetap tersedia. Tidak ada migrasi produksi atau deployment publik.

Discovery transaksi relayer eksternal, koreksi dan atestasi baru tetap irisan berikutnya. Tidak ada perluasan sumber atau opini audit otomatis.

## Pengujian

HTTP memakai PGlite durable, berkas terenkripsi terisolasi, validator asli, signature sintetis dan Anvil loopback. Ekspor diuji dengan CLI dan RPC asli. Kasus: anonim/lintas lembaga/READER, expiry/revokasi sesi dan keanggotaan, cache privat, sumber hilang, blok noncanonical, perubahan payload/signature, angka besar, ekspor-reimport. Smoke browser membuka ringkasan tanpa kredensial lalu mengunduh melalui UI pembaca dan menjalankan CLI untuk angka yang sama.

Hasil akhir validasi lokal #74:

- **24 tes registry/API/browser lulus**, termasuk tiga smoke browser dan ekspor ERC-1271 yang membutuhkan RPC.
- Suite backend penuh: **482 lulus, 20 gagal**. Seluruh 20 nama kegagalan sama dengan baseline #73; tidak ada kegagalan baru.
- Frontend: **133 lulus**; production build berhasil. Typecheck backend/frontend tidak menambah diagnostik dibanding checkout terisolasi `9171aab` setelah normalisasi nomor baris.
- Foundry lokal: **88 lulus**, fuzz 1.000 kasus dan invariant 128 × 32 panggilan; dua kontrak tes fork Sepolia live dikecualikan. Bytecode kontrak tidak diubah oleh #74.
- Review Standards dan Spec: **0 temuan tersisa** setelah perbaikan integritas berkas dan batas sumber rekap.

Log: `/tmp/ticket74-backend-final-tests.log`, `/tmp/ticket74-frontend-final-tests.log`, `/tmp/ticket74-foundry-final-tests.log`. Screenshot perilaku publik: `/tmp/ticket74-public-smoke.png` (harness tanpa stylesheet produksi). Ini bukti fixture lokal, bukan deployment publik atau audit independen.
