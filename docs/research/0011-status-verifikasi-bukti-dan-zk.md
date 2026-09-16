# Status Verifikasi Bukti Zakat dan ZK

- Tanggal: 2026-09-16.
- Metode: inspeksi statis jalur frontend, backend, kontrak, script, dan circuit dalam checkout. Tidak mengakses RPC, menjalankan prover, membaca secret, atau mengubah implementasi. Status deployment tidak disimpulkan dari keberadaan file.
- Konteks: ADR-0012 menjanjikan verifikasi Merkle; ADR-0019 memisahkan receipt governance yang sah dari simulasi; ADR-0021/0022 membahas bukti laporan periode; ADR-0031/0032 menambah penelusuran kontribusi dan konfirmasi penerimaan.

## Kesimpulan

**Kecurigaan bahwa halaman verifikasi masih mock terbukti dari kode. Alur yang dipakai halaman tersebut juga belum merupakan ZK.** Ada perhitungan Merkle sungguhan dan verifier paket laporan berbasis hash/signature, tetapi keduanya harus dibedakan dari proof ZK. Artefak ZK lama belum membentuk integrasi aktif yang dapat dinyatakan siap dipakai.

## 1. Halaman `/verifikasi`: sukses tanpa pemeriksaan proof

[Route](../../frontend/src/routes/verifikasi.tsx#L12) memasang `SearchReceiptForm`. Form tersebut melakukan GET `/api/donations/:trxId`, lalu menghitung leaf. Namun `verifyClientProof` hanya diimpor; hasil `isValid` ditetapkan `true` secara langsung. Root, sibling proof, jumlah, salt, dan batch ID mempunyai fallback buatan. Sumber: [SearchReceiptForm.tsx:54](../../frontend/src/features/verification/SearchReceiptForm.tsx#L54), [baris 73–90](../../frontend/src/features/verification/SearchReceiptForm.tsx#L73). Fungsi verifikasi hash yang nyata tersedia di [merkleClient.ts:18](../../frontend/src/lib/merkleClient.ts#L18), tetapi tidak dipanggil alur ini.

Lebih serius, ketika respons HTTP tidak sukses dan ID mengandung `TRX-` atau `USDC-`, form membuat receipt donatur fiktif, menetapkan `isValid: true`, lalu menampilkan pesan berhasil diverifikasi. Tidak ada pembatasan mode demo pada cabang tersebut. [SearchReceiptForm.tsx:95](../../frontend/src/features/verification/SearchReceiptForm.tsx#L95). Error jaringan yang melempar exception masuk pesan gagal, bukan cabang ini.

`isValid` tidak diteruskan ke komponen anak dan bukan gerbang rendering: keberadaan `receiptResult` saja menampilkan sertifikat. [SearchReceiptForm.tsx:182](../../frontend/src/features/verification/SearchReceiptForm.tsx#L182). Sertifikat memasang badge “Terverifikasi Sah & Permanen” tanpa pemeriksaan tambahan; detail Merkle juga berisi klaim tetap tentang anchor permanen, bukan hasil validasi. [CertificateCard.tsx:57](../../frontend/src/features/verification/CertificateCard.tsx#L57), [MerkleProofDetails.tsx:30](../../frontend/src/features/verification/MerkleProofDetails.tsx#L30).

Akibatnya, data ditemukan, belum dibayar, belum dibatch, tidak ditemukan, dan proof valid belum dibedakan secara andal. Ini masalah kebenaran hasil verifikasi, bukan sekadar tampilan ilustrasi.

## 2. Backend fiat: Merkle nyata, batas pemeriksaan berbeda

Endpoint POST `/api/verify-receipt` memeriksa `trxId`, salt, dan nominal melalui fungsi Merkle serta mengembalikan `false` bila tidak ditemukan. UI di atas tidak memakainya. [index.ts:586](../../backend/src/index.ts#L586). `dbService.getProofForTrx` sebenarnya hanya meneruskan ke penyimpanan memori; tree dan root diperiksa di sana. [db/index.ts:530](../../backend/src/db/index.ts#L530), [store.ts:108](../../backend/src/store.ts#L108). Tidak ditemukan rekonstruksi tree dari database pada startup; proof dapat tidak tersedia setelah restart meski catatan batch tersimpan.

Settlement membentuk tree dari donasi `PAID`, mengirim root ke kontrak, menunggu receipt, lalu menyimpan batch/tree. [index.ts:1818](../../backend/src/index.ts#L1818). Relayer memeriksa status receipt; fungsi ini belum memeriksa kecocokan event/root dan canonical block sebagaimana verifier laporan. [relayer.ts:51](../../backend/src/relayer.ts#L51). Kontrak menyimpan root dan nominal yang disampaikan pemegang `RELAYER_ROLE`; kontrak tidak membaca transaksi bank. [ZakatProtocolL1.sol:110](../../sc/src/ZakatProtocolL1.sol#L110).

Jadi, perhitungan inclusion yang benar membuktikan kesesuaian leaf dengan root yang diberikan. Untuk klaim anchor onchain, root tersebut masih harus dicocokkan dengan kontrak/chain yang benar. Kedua langkah itu tidak membuktikan uang diterima mustahik atau seluruh laporan benar.

Jalur pembayaran juga masih mencampur simulasi: `createSnapTransaction` mengembalikan token mock saat konfigurasi/API gagal. [midtrans.ts:165](../../backend/src/midtrans.ts#L165). POST `/api/webhooks/simulator` langsung mengubah donasi menjadi `PAID`; tidak terlihat guard mode sandbox atau autentikasi pada endpoint/middleware yang diperiksa. [index.ts:541](../../backend/src/index.ts#L541), [middleware:179](../../backend/src/index.ts#L179). Webhook pembayaran bertanda tangan tersedia terpisah; keberadaannya tidak menutup simulator tersebut.

## 3. USDC dan akses donatur

Donasi USDC aktif memanggil `ZakatProtocolL1.depositUSDC`, bukan `ZKTCore.donateZK`. Helper mengembalikan sukses setelah memperoleh hash broadcast; form langsung menampilkan modal berhasil tanpa menunggu receipt di jalur itu. [web3Client.ts:121](../../frontend/src/lib/web3Client.ts#L121), [DonationForm.tsx:148](../../frontend/src/features/donation/DonationForm.tsx#L148). Kontrak melakukan transfer token dan mengeluarkan event, tanpa verifier ZK. Opsi anonim menyamarkan alamat pada event khusus, sementara pemanggil/transaksi token tetap dapat diamati. [ZakatProtocolL1.sol:131](../../sc/src/ZakatProtocolL1.sol#L131).

Pencarian donatur menggunakan ID transaksi saja. GET status mengembalikan nama, nominal, salt, dan informasi pembayaran tanpa pemeriksaan bahwa pemohon pemilik kontribusi. [index.ts:398](../../backend/src/index.ts#L398). Memiliki ID atau salt yang dikirim endpoint yang sama bukan autentikasi donatur. Wallet USDC mengotorisasi transaksi; itu belum memberi sesi akses catatan kontribusi.

Auth challenge/signature, nonce sekali pakai, keanggotaan, dan session memang sudah tersedia **untuk ruang kerja lembaga**. [workspace.ts:188](../../backend/src/routes/workspace.ts#L188). Belum ditemukan pengikatan auth donor pada alur pencarian tersebut. Batas akses ADR-0032 karenanya masih membutuhkan implementasi tersendiri sebelum data kontribusi privat diberikan.

## 4. Registry laporan bukan ZK

`ReportEvidenceRegistry` memeriksa signature/kewenangan lembaga dan validator, identitas paket, versi, predecessor, digest, nonce, serta deadline. Publikasi membutuhkan dua pengesahan atas payload sama dengan hasil `LOLOS`. [ReportEvidenceRegistry.sol:176](../../sc/src/ReportEvidenceRegistry.sol#L176). Verifier offchain menghitung ulang commitment, angka/rekonsiliasi, vonis, dan hash berkas; pemeriksaan receipt canonical membutuhkan koneksi RPC. [report-verifier.ts:13](../../backend/src/report-verifier.ts#L13), [baris 88](../../backend/src/report-verifier.ts#L88).

Ini implementasi nyata untuk konsistensi paket dan pengesahan; bukan pembuktian komputasi zero-knowledge atau bukti otomatis kejadian fisik. Pernyataan ADR lama bahwa registry belum dibangun merupakan snapshot keputusan, bukan status kode sekarang. Konfigurasi registry tetap opsional dan eksplisit. [registry-wiring.ts:7](../../backend/src/registry-wiring.ts#L7).

## 5. Artefak ZK: ada, tetapi terputus dan belum lengkap

Pencarian pada `frontend/src` dan `backend/src` tidak menemukan pemanggilan prover Noir/Circom atau entrypoint DAO ZK. Konfigurasi aktif menunjuk `ZakatProtocolL1`. [contracts.ts:4](../../frontend/src/lib/contracts.ts#L4), [config.ts:1](../../backend/src/config.ts#L1).

- **Verifier placeholder:** `HonkVerifier.verify`, `Groth16Verifier.verifyProof`, dan `ZKVerifier.verify` mengembalikan `false`. `ZKVerifier.anchorProof` hanya mencatat hash/nullifier; alias `isVerified` bukan validasi proof. [HonkVerifier.sol:50](../../sc/src/DAO/verifiers/HonkVerifier.sol#L50), [Groth16Verifier.sol:91](../../sc/src/DAO/verifiers/Groth16Verifier.sol#L91), [ZKVerifier.sol:53](../../sc/src/DAO/verifiers/ZKVerifier.sol#L53).
- **Binding kontrak belum cukup:** `donateZK`/`donateZKPrivate` menerima `nullifier` terpisah tanpa pemeriksaan kesamaan dengan public input proof. Konteks pool/pemanggil/nominal juga tidak dicocokkan di entrypoint tersebut. Mengganti verifier saja belum menyelesaikan integrasi. [ZKTCore.sol:554](../../sc/src/DAO/ZKTCore.sol#L554).
- **Noir arsip:** circuit memeriksa predikat pendapatan/aset, waktu, nullifier, dan commitment nominal. Ia tidak membuktikan pembayaran atau penyerahan bantuan, dan masukan pendapatan/aset tidak diikat ke sumber institusional. Script prover memakai `/tmp/zkt-bench` serta tool di `/tmp`, mengisi expected nullifier nol, dan tidak memasukkan `amount` yang diwajibkan circuit arsip. Path sementara tersebut tidak ada saat inspeksi; keduanya bukan pipeline reproduktif yang cocok. [main.nr:18](../../archive/noir-circuits/zkat_eligibility/src/main.nr#L18), [GenerateZKProof.mjs:20](../../sc/script/GenerateZKProof.mjs#L20).
- **Circom arsip:** coordinator memakai path `sc/circuits` yang tidak ada, membership path dummy, dan nullifier root nol. Verification key arsip mempunyai tujuh public signals, sedangkan interface Solidity enam. Komponen nullifier arsip menetapkan `valid = 1`, tanpa membuktikan hubungan secret atau non-reuse terhadap root. [ProofGenerator.js:14](../../sc/offchain-coordinator/src/modules/ProofGenerator.js#L14), [baris 70](../../sc/offchain-coordinator/src/modules/ProofGenerator.js#L70), [verification_key.json:4](../../archive/circuits/build/verification_key.json#L4), [Nullifier.circom:47](../../archive/circuits/components/Nullifier.circom#L47).

Komentar Honk menyebut artefak generated verifier dan masalah ukuran bytecode, tetapi file artefak yang dirujuk tidak ada pada checkout. Klaim ukuran historis belum diukur ulang. Tes `MockHonkVerifier` yang selalu `true` hanya membantu menguji alur kontrak; bukan bukti ZK nyata. [TestDonateZKPrivate.t.sol:316](../../sc/test/TestDonateZKPrivate.t.sol#L316).

## 6. Gerbang menuju integrasi nyata

Rekomendasi berikut belum memilih Noir, Circom, atau standar NFT:

1. Tetapkan pernyataan yang hendak dibuktikan, data yang disembunyikan, sumber tepercaya, dan siapa yang memegang witness. Pisahkan inclusion kontribusi, otorisasi akses donor, perhitungan laporan, dan konfirmasi penerima.
2. Hilangkan hasil sukses buatan dari jalur pilot; pisahkan status belum dibayar/belum dibatch/belum dikonfirmasi/tidak tersedia/tidak valid. Pastikan simulasi tidak masuk data pilot.
3. Untuk Merkle, verifikasi path dan anchor canonical, pertahankan rekonstruksi proof setelah restart, dan uji perubahan nominal/salt/root serta transaksi tidak ditemukan.
4. Bila ZK diperlukan, bangun circuit–prover–verification key–verifier dari sumber/version terkunci; cocokkan urutan public inputs serta binding chain, kontrak, aksi, lembaga, versi, dan nullifier sesuai statement yang dipilih.
5. Uji proof nyata end-to-end dan penolakan manipulasi/replay/konteks berbeda, lalu ukur biaya dan pengalaman pengguna. Hash transaksi, NFT, atau pengujian dengan verifier mock tidak memenuhi gerbang ini.

Tidak ada tes runtime dijalankan dalam investigasi ini; temuan cabang mock dan verifier konstan berasal dari kode langsung. Kondisi layanan terpasang, circuit yang pernah dibangun di luar repo, dan data pilot belum diverifikasi.
