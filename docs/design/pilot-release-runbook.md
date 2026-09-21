# Runbook gerbang rilis pilot — #115

Status 2026-09-21: **BELUM DISETUJUI UNTUK RILIS**. Acuan: [#115](https://github.com/tawf-labs/zkt-hackathon/issues/115), [spec #100](../specs/pilot-distribution-zk-nft.md), ADR-0020–0022. Dokumen ini adalah prosedur yang harus dijalankan operator berwenang, bukan catatan bahwa deployment, backup PostgreSQL pilot, atau penerimaan mitra telah dilakukan. Hasil lokal dicatat terpisah dalam [matriks verifikasi](../verification/0115-pilot-release-gate.md).

## Gerbang sebelum tindakan operasional

1. Tetapkan lembaga, penanggung jawab, SOP/mandat, tanggal dan volume, perangkat/koneksi, kanal kontak yang benar-benar tersedia, format laporan, kebijakan biaya/valuasi/refund, anggaran layanan, retensi serta penerimaan mitra. Simpan dokumen berisi PII di penyimpanan terbatas; tiket publik hanya memuat referensi dan status persetujuan.
2. Catat URL frontend/API tujuan, pemilik hosting, chain ID dan jaringan untuk masing-masing registry/vault, alamat serta blok deployment, bytecode/domain, kebijakan konfirmasi dan finalitas, akun pengesah/validator/auditor/pemegang NFT, dan otorisasi perubahan. Manifest September 8 bukan manifest kontrak pilot baru.
3. Jangan mengarahkan prover saat ini ke jaringan nonlokal: `backend/src/workspace-wiring.ts` membatasi RPC ZK ke loopback dan chain Foundry. Setup Groth16 pada `sc/circuits` hanya setup lokal satu operator. Target nonlokal dan setup yang dapat diterima harus diputuskan serta diimplementasikan/diverifikasi lebih dahulu; jangan melewati guard atau menganggap tunnel menjadikannya aman produksi.
4. Review isu terbuka #116 (enumerasi referensi kontribusi), #117 (pageerror reload sesi), dan #118 (proses Anvil tersisa setelah terminasi). Catat pemilik, dampak terhadap cakupan yang dipilih dan keputusan gerbang; jangan menutup isu tersebut atas nama #115. Masalah privasi bukan sekadar warning yang boleh disembunyikan oleh hasil suite hijau.
5. Otorisasi deployment, transaksi, migrasi dan kirim OTP harus spesifik pada lingkungan serta tujuan. Jangan memakai data/kontak mitra untuk tes tanpa izin. Jangan menyalin `.env`, private key, token, OTP, witness, ciphertext, atau locator dokumen ke paket bukti publik.

## Inventaris konfigurasi yang harus diverifikasi

Nama di bawah adalah nama konfigurasi, **bukan nilainya**. Keberadaan variabel saja bukan bukti koneksi, kewenangan, atau kecukupan saldo.

| Area | Yang harus dicocokkan dengan implementasi dan manifest |
| --- | --- |
| SQL | `DATABASE_URL`; versi PostgreSQL, pemilik, TLS, backup dan target restore terpisah. |
| Berkas | `EVIDENCE_FILE_DIR`, `EVIDENCE_FILE_KEY`; ciphertext persisten, akses terbatas, backup kunci terpisah, download terotorisasi setelah restore. |
| OTP donor | `DONOR_OTP_KEY`, `RESEND_API_KEY`, `DONOR_OTP_EMAIL_FROM`; pengiriman nyata ke kontak uji yang diizinkan, expiry dan revocation. Adapter bawaan donor mendukung email, bukan SMS/WhatsApp. Kunci OTP sementara per proses bukan konfigurasi multi-instance/restart yang memadai. |
| Konfirmasi penerima | Verifikasi wiring transport yang benar-benar tersedia dan metode OTP/BAST sesuai SOP. Jangan menyimpulkan provider donor otomatis menjadi provider penerima. |
| Registry laporan | Semua `REPORT_REGISTRY_{RPC_URL,CHAIN_ID,ADDRESS,RELAYER_KEY,CONFIRMATIONS}`, plus `REPORT_REGISTRY_VALIDATOR_KEY` untuk publikasi. Periksa role pengesah/validator, domain dan dua pengesahan paket yang sama. |
| ZK | `ZK_RPC_URL`, `ZK_REGISTRY_ADDRESS`, `ZK_RELAY_PRIVATE_KEY`, `ZK_MAX_ATTEMPTS`, `ZK_MAX_WEI`, `ZK_GAS_LIMIT`, `ZK_MAX_FEE_PER_GAS`, `ZK_CONFIRMATIONS`. Default anggaran nol berarti tidak siap publikasi. Jalur saat ini lokal saja. |
| NFT | Semua `CERTIFICATE_NFT_{RPC_URL,CHAIN_ID,ADDRESS,RELAYER_KEY,CONFIRMATIONS,BUDGET_WEI,GAS_LIMIT,MAX_FEE_PER_GAS}`; `mandateSource` harus cocok registry laporan. Verifikasi custodian institusi dan mandat recovery, bukan wallet donor. |
| Kebijakan laporan | `REPORT_AMIL_RULES_JSON` harus berasal dari kebijakan sah, bukan angka rekaan untuk meloloskan validator. |
| Native USDC | Chain, alamat vault, blok awal/indexer key, jumlah minor 6 desimal dan identitas event tetap eksak. Jangan memakai nilai IDR estimasi untuk backfill. |
| Frontend | URL API dan alamat/chain sesuai backend; tidak membawa rahasia server. Hasil build SSR bukan situs statis yang cukup dipublikasikan dari folder public saja. |

Dockerfile/Compose root belum merupakan paket rilis pilot terverifikasi: Dockerfile mengacu `package.json` root yang tidak ada pada baseline, dan runtime backend hanya menyalin `backend`, bukan `shared`, `sc/circuits`/artefak atau runtime Node prover. Jangan menyatakan build Bun/Vite membuktikan image ini dapat dipakai. Pilih jalur packaging setelah target disepakati, lalu build dan smoke image/host tersebut secara nyata.

## Backup, restore dan migrasi pada salinan terisolasi

**Prasyarat:** pemilik DB/storage memberikan izin, target salinan terpisah teridentifikasi, operator mengetahui cara menghentikan seluruh writer (API, indexer, job ZK, relayer/mint) dan mencegah startup recovery berjalan pada jaringan publik. Jangan menggunakan flag deployment lama sebagai asumsi bahwa semua worker berhenti.

1. Ambil inventaris sebelum perubahan: versi build/config, seluruh tabel legacy dan pilot, schema/index/constraint, volume baris, ledger/witness, file manifest, pending attempt, signed transaction/nonce, checkpoint dan pasangan deployment. Inventaris rahasia tetap privat.
2. Quiesce writer; buat backup PostgreSQL konsisten dengan tooling yang cocok versinya, ciphertext yang cocok pada titik waktu itu, dan kunci yang di-escrow terpisah. Catat checksum arsip, waktu, pemilik, enkripsi, RPO/RTO dan lokasi terbatas. Backup SQL saja tidak memulihkan dokumen; ciphertext saja tanpa SQL/kunci juga tidak cukup.
3. Restore ke DB dan direktori baru. Sebelum menjalankan aplikasi, pastikan RPC/signing/provider pesan terisolasi, tidak ada indexer/worker produksi, dan target bukan DB kerja. Jangan restore dengan `clean/reset` terhadap DB sumber.
4. Pada salinan tersebut, jalankan versi kandidat hingga seluruh `ensureSchema` selesai tanpa error. Urutan workspace saat ini: tenancy → evidence → disbursement → contributions → activities → audit findings → donor access → batch ZK → publication ZK → registry → certificate. Periksa diff schema yang sebenarnya; `CREATE IF NOT EXISTS` tidak membuktikan semua backfill/constraint berhasil.
5. Verifikasi backfill historis melalui prosedur khusus yang sudah ada sebelum apply: `usdc:verify`, `proposal:verify`, `proposal:decisions:verify`. Perintah `*:apply`/`*:migrate` hanya setelah hasil ditinjau dan sumber dapat dibuktikan. Unknown tetap unknown; tidak mengarang event, versi, penerima, atau nominal agar constraint lulus.
6. Ulangi schema initialization; buktikan idempotensi, legacy row/amount/event identity tidak berubah, riwayat batch/receipt/refund/NFT/mandat/atestasi tetap utuh, satu successor resmi dan batas alokasi tetap berlaku. Catat jumlah aktual sebelum/sesudah, kegagalan, durasi, serta fingerprint build yang diuji.
7. Login melalui HTTP memakai sesi sah; baca paket dan unduh file terbatas byte-for-byte. Uji pihak lain ditolak. Jalankan drill kehilangan/corruption/restore berkas dengan [endpoint pemulihan yang sudah tersedia](registry-recovery-operations.md#verifikasi-dan-pemulihan-backup-berkas); backup salah ditolak, backup benar memulihkan tanpa mengganti commitment/timestamp.
8. Hentikan dan nyalakan kembali layanan/salinan DB; periksa pending attempt, nonce dan anggaran yang telah direservasi. Pulihkan pengamatan canonical dahulu. Retry menggunakan byte tersimpan, bukan membuat receipt/token/transaksi resmi kedua. Putus RPC atau simulasi reorg hanya pada EVM uji.
9. Catat hasil restore **keseluruhan** dan persetujuan pemilik sebelum menjalankan perubahan yang sama pada target. Restart PGlite atau restore satu dokumen dalam suite otomatis bukan drill disaster recovery PostgreSQL pilot.

## Pemulihan dan rollback

- Bila verifikasi gagal, hentikan writer/publikasi baru, pertahankan bukti insiden dan jangan menghapus attempt/history/nonce. Status pending, unavailable atau noncanonical tidak boleh diganti manual menjadi confirmed.
- Untuk registry laporan, jalankan pembacaan recovery dan pulihkan predecessor sebelum transaksi yang bergantung padanya. Ikuti [runbook #78](registry-recovery-operations.md); retry harus tetap memenuhi mandat, deadline, domain, berkas dan canonical receipt.
- Untuk ZK, pertahankan raw transaction, versi batch/receipt, root historis dan reservation anggaran. Koreksi tidak membuat proof pendahulu current lagi karena publikasi penerus gagal. Ikuti [#109](../verification/0109-recoverable-zk-publication.md) dan [#110](../verification/0110-batch-correction-and-receipt-validity.md).
- Untuk NFT, pisahkan kegagalan mint dari realisasi fisik. Pemulihan custodian menggunakan penerbitan pengganti berotorisasi, bukan transfer admin tersembunyi; ikuti [#113](../verification/0113-certificate-custody-recovery.md#runbook-operator-tanpa-secret).
- Rollback aplikasi hanya ke pasangan app/config/schema yang sudah diuji kompatibel. Pertahankan tabel aditif dan history; jangan down-migrate dengan drop tabel. Jika perlu restore checkpoint backup, pulihkan dahulu ke salinan baru dan rekonsiliasi semua write/tx sesudah backup sebelum cutover yang diotorisasi.
- Transaksi onchain tidak dihapus oleh rollback SQL. Jangan mengaktifkan backup lama yang melupakan transaksi, nonce atau anggaran yang sudah terpakai. Penggantian deployment memerlukan manifest baru; token ID/alamat/signature lintas deployment bukan identitas yang sama.
- Bila tidak tersedia jalur rollback yang mempertahankan transaksi sesudah backup, tetap hentikan writer dan minta keputusan pemilik insiden. Jangan membuat klaim recovery selesai.

## Penerimaan melalui URL target

Setelah semua gerbang di atas dipenuhi, operator mencatat URL/build/deployment dan waktu untuk setiap skenario AC01–AC34, bukan hanya hasil unit test. Jalankan navigasi aplikasi sebenarnya pada laptop/ponsel: ruang kerja, impor/realisasi/konfirmasi, donor OTP, sumber/rekonsiliasi/laporan, pengesahan sertifikat, ZK/NFT, koreksi, pemeriksa dan logout/revocation. Verifikasi LPZN menghasilkan `668020210274` dan draf salah ditolak melalui API target. Catat HTTP, console/pageerror, akses keyboard, status/error dan korelasi receipt/chain tanpa menaruh token/PII di log.

Lembaga membuktikan penyaluran melalui prosesnya sendiri dan memberi penerimaan tertulis atas hasil; fixture OTP/BAST sintetis bukan bukti lapangan. Pemeriksa memakai sumber laporan yang sama dan akun institusi memegang NFT. Jika URL, provider, SOP, mandat, setup, packaging atau drill belum tersedia/lulus, hasil akhir tetap **BLOCKED / BELUM SIAP**, dan #115 tetap OPEN.
