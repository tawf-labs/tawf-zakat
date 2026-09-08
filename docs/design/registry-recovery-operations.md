# Pemulihan registry dan berkas pilot — tiket #78

Status: implementasi pengembangan, data sintetis dan EVM lokal. Tidak ada deployment atau migrasi produksi dalam tiket ini. Kebijakan `block-depth-v1:<chainId>:<confirmations>` berarti kedalaman blok RPC, **bukan finalitas settlement L1**, termasuk ketika Arbitrum sequencer sudah memasukkan transaksi.

## Konfigurasi dan identitas deployment

Registry menggunakan konfigurasi eksplisit, terpisah dari vault:

- `DATABASE_URL`: PostgreSQL ruang kerja. Untuk pengujian, PGlite dengan direktori sementara tersendiri; tidak memakai URL produksi.
- `REPORT_REGISTRY_RPC_URL`, `REPORT_REGISTRY_CHAIN_ID`, `REPORT_REGISTRY_ADDRESS`: RPC dan registry yang domain EIP-712-nya diperiksa pada setiap pembacaan. Registry domain `Tawf Report Evidence`, versi `1`.
- `REPORT_REGISTRY_RELAYER_KEY`: kunci relayer, disimpan di pengelola rahasia. Byte transaksi bertanda tangan disimpan di database sebelum broadcast. Rotasi relayer tidak menghapus percobaan lama.
- `REPORT_REGISTRY_VALIDATOR_KEY`: kunci layanan validator untuk penerbitan, berbeda dari pengesah lembaga.
- `REPORT_REGISTRY_CONFIRMATIONS`: bilangan bulat positif yang eksplisit; fixture lokal memakai 2.
- `EVIDENCE_FILE_DIR`, `EVIDENCE_FILE_KEY`: direktori ciphertext dan kunci AES-256-GCM 32 byte. Simpan backup kunci terpisah; tanpa kunci backup ciphertext tidak dapat dibaca.

Catat manifest pilot versi baru sebelum mengganti jaringan, alamat, atau kebijakan: tanggal, chain ID, genesis hash, alamat registry, transaction/block hash deployment, runtime bytecode hash, domain/version, blok awal, kebijakan konfirmasi, identitas operator dan lokasi backup. `chainId:registry` merupakan scope checkpoint/event; alokasi nonce juga memuat alamat relayer. Penggantian kebijakan membuat checkpoint lama memerlukan pemeriksaan ulang. Manifest vault lama tidak diubah otomatis.

Server API memulai pemantauan setelah skema siap. Putaran selesai dahulu sebelum putaran berikutnya, jeda 5 detik. Semua lembaga dengan intent tersimpan diperiksa, termasuk intent yang sudah terkonfirmasi. Kegagalan satu lembaga tidak menghentikan lembaga lain. Pilot membaca ulang log dari genesis dalam batch paling banyak 2.000 blok: event yang terlambat juga ditemukan. Ini sengaja ditujukan untuk registry pilot kecil; biaya RPC bertambah dengan riwayat. Jangan menggunakan pemindaian ini sebagai klaim kesiapan indexer berskala besar.

## Migrasi pengembangan dan restart

1. Hentikan writer pada salinan pengembangan. Ambil backup PostgreSQL dan ciphertext beserta kunci yang sesuai; simpan manifest checksum backup di lokasi terbatas.
2. Pulihkan ke database/direktori uji yang terpisah. Pastikan URL, kunci, dan RPC menunjuk fixture lokal.
3. Jalankan API: `cd backend && bun run start:api`. `ensureSchema` menambahkan `registry_observations`, `registry_events`, dan `registry_checkpoints` dengan `IF NOT EXISTS`. Tidak melakukan backfill status terkonfirmasi atau menulis ulang paket lama.
4. Masuk menggunakan tantangan akses lembaga sintetis. `POST /api/workspace/recovery` dengan `{}` menjalankan satu pemeriksaan; hanya ADMIN/OFFICER. `GET` tersedia bagi pembaca lembaga. Endpoint tidak menerima chain, lembaga, checkpoint, atau status dari payload. Query `institutionId` yang bertentangan dengan sesi ditolak.
5. Cocokkan checkpoint, kebijakan, event, dan hash transaksi dengan Anvil. Restart proses/database, ulangi pemeriksaan, dan pastikan event yang sama tidak menjadi catatan ganda.

Event memuat chain, registry, transaction hash, log index, block number dan block hash. Identitas penyimpanan juga memuat block hash agar inclusion yang gugur tetap tersedia sebagai riwayat. Observasi disimpan append-only per bukti observasi unik; waktu pemeriksaan ulang terbaru berada di checkpoint. Tabel `registry_attempts` tetap mempertahankan byte transaksi, signature, hash, dan nonce.

Seluruh event, perubahan canonical, dan observasi satu putaran disimpan dalam **satu transaksi database dengan checkpoint sebagai penulisan terakhir**. Crash sebelum commit membatalkan semuanya. Dua putaran bersaing memakai kunci baris dan pemeriksaan checkpoint sebelumnya. Kedalaman konfirmasi dipatok pada blok acuan awal. Blok baru boleh bertambah selama pembacaan; hanya penggantian blok acuan oleh reorg yang membatalkan putaran. Jika receipt terverifikasi belum terdapat dalam hasil log, checkpoint ditahan.

## Membaca dan memulihkan status transaksi

- `PREPARED`: belum ada transaksi tersimpan. Pengguna masih harus menandatangani.
- `SUBMITTED`: belum terbukti masuk blok; termasuk broadcast hilang/ditolak. Jangan menyebut ini sukses.
- `INCLUDED`: receipt dan event cocok, tetapi kedalaman blok belum cukup.
- `CONFIRMED`: kebijakan kedalaman blok tercapai saat observasi. Pemantauan tetap berlanjut.
- `REVERTED` / `INVALID_EVENT`: gagal atau tidak membuktikan tindakan yang dimaksud. Periksa alasan dan kewenangan sebelum menyiapkan pengesahan baru.
- `NONCANONICAL`: blok terdahulu gugur. Paket dan percobaan tetap disimpan; garis resmi serta atestasi dibaca lagi dari registry canonical.
- `CATCHING_UP`: checkpoint canonical tersimpan, tetapi ada blok baru yang akan dibaca putaran berikutnya.
- `RECHECK_REQUIRED` pada respons pemulihan: checkpoint berubah canonical/kebijakan, lebih lama dari 30 detik, atau RPC tidak tersedia. Riwayat bukan bukti keberhasilan terbaru.

Pemulihan tidak otomatis mengirim transaksi atau membuat signature baru. Gunakan tombol kirim ulang pada pencatatan/penerbitan/atestasi, atau endpoint `POST .../<intentId>/retry` dengan `{}`. Byte dan hash lama digunakan kembali; kewenangan, deadline, predecessor, serta berkas wajib diperiksa melalui jalur transaksi yang sudah ada. Pulihkan predecessor publikasi dahulu sebelum atestasi yang bergantung padanya. Bila nonce sudah dipakai transaksi lain atau signature sudah tidak berlaku, jangan mengubah percobaan lama: periksa chain dan siapkan tinjauan/pengesahan baru melalui alur normal.

Koreksi yang gugur tidak lagi menjadi versi resmi terkini; registry memulihkan predecessor. Atestasi yang gugur tidak menghasilkan opini pengganti. Atestasi yang baru included belum masuk daftar atestasi terkonfirmasi pada versi/publikasi. Riwayat pencatatan tetap berbeda dari state canonical.

## Verifikasi dan pemulihan backup berkas

`GET /api/workspace/recovery/files?preparationId=<id>` memeriksa **setiap** berkas pada manifest snapshot: `AVAILABLE`, `MISSING`, `CORRUPT`, atau `UNAVAILABLE`. Tambahkan `intentId=<id>` untuk bukti atestasi; catatan auditor yang belum terkonfirmasi hanya boleh diperiksa auditornya sendiri. Semua akses terikat lembaga. Locator dan salt tidak dikembalikan endpoint ini.

1. Di salinan uji, unduh sumber yang berwenang diakses dan rekam hash/ukuran. Simpan backup terenkripsi dan kuncinya secara terpisah. Jangan memasukkan isi dokumen/token ke log atau riwayat shell.
2. Pindahkan ciphertext asli ke direktori backup uji untuk mensimulasikan kehilangan. Endpoint pemeriksaan harus menyebut `MISSING`; commitment dan tanggal snapshot tetap sama.
3. Pulihkan backup di UI **Pemeriksaan dan pemulihan bukti**, atau `POST /api/workspace/recovery/files` dengan `preparationId`, `fileId`, `contentBase64`, dan `intentId` opsional untuk atestasi. Gunakan sesi ADMIN/OFFICER dan HTTPS pada pilot.
4. Server memverifikasi commitment snapshot/atestasi, lalu ukuran dan SHA-256 plaintext backup terhadap manifest terikat. Isi sumber terbaru dengan hash berbeda ditolak 409. Berkas yang sejak awal gagal tersimpan tidak diberi hash baru.
5. Byte yang cocok dienkripsi kembali, ditulis ke berkas sementara mode 0600, di-fsync, kemudian di-rename dan direktori di-fsync. Kunci dan locator tetap. Tidak ada perubahan isi, salt, commitment, pengesahan atau timestamp paket. Ciphertext boleh berbeda karena nonce enkripsi baru.
6. Server membaca ulang hasil pemulihan dan memeriksa hash. Unduh lewat endpoint sumber semula dan verifikasi lagi. Untuk disaster recovery keseluruhan, pulihkan database, ciphertext dan kunci yang cocok dahulu; endpoint ini bukan pengganti backup database.

Tidak ada penghapusan otomatis atau retensi produksi. Sebelum data pribadi mitra digunakan, isi dan setujui: identitas/mandat mitra, akun dan pemilik kunci, lokasi penyimpanan dan akses backup, kebijakan retensi, RPO/RTO, jadwal drill, penanggung jawab insiden, transport HTTPS, serta parameter jaringan/konfirmasi. Data sintetis bukan bukti bahwa onboarding itu sudah selesai.

## Bukti pengujian lokal

Dari `sc`: `forge test`. Dari `backend`: `bun test test/registry_api.test.ts --test-name-pattern '^recovery'`.

Tes memakai app.fetch, PGlite yang benar-benar ditutup/dibuka kembali, filesystem terenkripsi terisolasi dan Anvil. Fault injection mencakup sebelum persistensi event, antara event/observasi dan checkpoint, log ganda/terlambat, broadcast hilang, restart, reorg nyata, berkas hilang, backup berbeda dan backup identik. Perjalanan lengkap mencatat paket, menerbitkan, mengoreksi dan mengatestasi; setelah reorg, predecessor dan status auditor dipulihkan, lalu transaksi yang sama dikirim kembali. Backup bukti atestasi juga dipulihkan dan diunduh ulang.

Smoke browser opsional: set `REGISTRY_BROWSER_MODULE` ke instalasi Playwright lokal dan `REGISTRY_BROWSER_EXECUTABLE` ke Chromium yang tersedia bila perlu, lalu jalankan `bun test test/registry_api.test.ts --test-name-pattern 'browser: recovery'`. Tidak ada layanan AI, data bank, pinning publik, atau transaksi testnet yang digunakan.

### Hasil verifikasi implementasi (2026-09-08)

- Suite backend penuh: 508 lulus, 20 gagal. Seluruh 48 tes registry, termasuk enam smoke browser, lulus. Ke-20 kegagalan lainnya sama dengan pengujian ulang commit awal `ad75af6` pada salinan terisolasi (495 lulus, 20 gagal, lima browser tidak diaktifkan); tidak ada kegagalan baru.
- Suite frontend: 133 lulus.
- Foundry: 148 lulus; dua tes fork vault lama gagal karena RPC Sepolia eksternal tidak terjangkau. Seluruh tes registry lokal lulus; tidak ada pengujian transaksi jaringan publik.
- Typecheck dibandingkan dengan commit awal pada salinan terisolasi: backend tetap 14 error lama, frontend tetap 138 error lama, tanpa lokasi error baru.
- Review Standards dan Spec dijalankan terpisah. Temuan head yang bergerak dan klasifikasi ciphertext ditutup dengan tes regresi; tidak ada temuan terbuka pada review ulang.
