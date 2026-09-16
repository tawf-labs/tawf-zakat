# Kelayakan toolchain ZK untuk verifikasi bukti pilot

Tanggal pemeriksaan: 16 September 2026. Riset dokumentasi resmi dan konfigurasi lokal; tidak menjalankan proving, memasang dependency, mengukur gas, atau memeriksa deployment/RPC. Ini rekomendasi eksperimen, bukan keputusan toolchain atau bukti kesiapan produksi.

**Keputusan setelah riset:** Q23 menerima pencatatan keberhasilan proof sebagai transaksi sekali per versi receipt, dengan pemeriksaan ulang tanpa transaksi baru; Q24 menerima riwayat koreksi. Pertanyaan terbuka tentang persistensi dalam pembahasan teknis di bawah dijawab oleh [ADR-0034](../adr/0034-private-contribution-membership-zk-priority.md).

## Kesimpulan

**Noir + Barretenberg layak menjadi kandidat pertama PoC yang dibatasi**, dengan Circom + snarkjs/Groth16 sebagai pembanding bila ada hambatan terukur. Dokumen resmi sekarang menyediakan jalur generated Solidity verifier; hambatan ukuran verifier pada paper lama tidak cukup untuk menyimpulkan jalur ini masih mustahil. Sebaliknya, adanya tutorial juga belum membuktikan circuit kita dapat dideploy. Statement pilot tetap keputusan Q19: kontribusi tertentu termasuk dalam batch yang diendors institusi. Q20 mengizinkan backend memegang witness, Q21 menerima verifier aktual, dan Q22 menetapkan batch dari sumber yang direkonsiliasi institusi.

## Jalur resmi dan batas versi

Panduan Barretenberg menjelaskan `nargo execute` untuk witness, `bb write_vk --oracle_hash keccak`, `bb write_solidity_verifier`, dan `bb prove --oracle_hash keccak`. Proof dan public inputs merupakan keluaran terpisah; urutan input harus cocok dengan ABI circuit. Generated entrypoint berbentuk `verify(bytes,bytes32[]) external view returns(bool)`. Jadi ini jalur verifikasi kriptografi yang berbeda dari menyimpan hash proof. Panduan mencantumkan kebutuhan precompile EVM dan penggunaan optimizer, tetapi contoh tersebut bukan pengukuran circuit kita. [Panduan resmi Solidity verifier](https://barretenberg.aztec.network/docs/how_to_guides/how-to-solidity-verifier/).

Versi terbaru setiap komponen **tidak otomatis kompatibel**. Saat diperiksa, [rilis Noir](https://github.com/noir-lang/noir/releases) memuat `1.0.0-rc.1` dan nightly 15 September; [Aztec packages v5.2.0](https://github.com/AztecProtocol/aztec-packages/releases/tag/v5.2.0) bertanggal 17 Agustus 2026. Namun [mapping resmi bbup](https://github.com/AztecProtocol/aztec-packages/blob/next/barretenberg/bbup/bb-versions.json) yang terbaca hanya sampai Noir `1.0.0-beta.22` → BB `5.0.0-nightly.20260522`; beta.18 dipetakan ke `3.0.0-nightly.20260102`. Mapping pada branch bergerak bukan jaminan dukungan/security terbaru. Riset ini belum membuktikan pasangan rc.1/BB tertentu bekerja. Pilih pasangan berdasarkan bukti kompatibilitas resmi, pin commit/checksum, lalu buktikan dengan circuit dan verifier yang sama; jangan mencampur CLI tutorial lintas versi.

Kondisi lokal memperkuat kebutuhan reproduksibilitas:

- `nargo --version` menghasilkan beta.18; `bb`, `circom`, dan `snarkjs` tidak ditemukan pada PATH sesi. Ini bukan klaim tidak ada instalasi di lokasi lain.
- [GenerateZKProof.mjs:9](../../sc/script/GenerateZKProof.mjs#L9) masih menyebut beta.21+, BB 4.2.1 dan direktori `/tmp`; bukan manifest toolchain yang dapat direproduksi.
- [foundry.toml:5](../../sc/foundry.toml#L5) mematok solc 0.8.31, optimizer satu run dan `via_ir`; konfigurasi yang cocok harus diukur terhadap generated verifier baru.
- [package.json:16](../../sc/offchain-coordinator/package.json#L16) mendeklarasikan snarkjs `^0.7.3`; [lockfile:2513](../../sc/offchain-coordinator/package-lock.json#L2513) menyelesaikannya ke 0.7.6. Keberadaan dependency coordinator lama tidak membuktikan integrasi receipt.

## Ukuran kontrak, biaya, dan arti “onchain”

[EIP-170](https://eips.ethereum.org/EIPS/eip-170) membatasi deployed runtime code menjadi 24.576 byte pada lingkungan yang menerapkan aturan tersebut. Ukur runtime setiap kontrak hasil kompilasi, bukan panjang source atau hanya creation bytecode. Generated verifier, konfigurasi compiler dan chain target harus dicatat. Panduan resmi Barretenberg memperlihatkan optimizer sebagai cara mengatasi peringatan ukuran pada contohnya; hasil paper lama tetap snapshot historis, bukan batas universal toolchain sekarang. Belum ada hasil ukuran, latency, RAM, atau gas circuit pilot dari riset ini.

Karena verifier `view`, pemanggil dapat memakai `eth_call` terhadap kode yang sudah dideploy: proof diperiksa oleh eksekusi EVM tanpa transaksi donor, wallet donor, atau biaya transaksi per pemeriksaan. Ini **tidak memasukkan proof/result ke blok** dan tidak menghasilkan status/event persisten. Bila hasil dipakai dalam transaksi perubahan state, transaksi itu membutuhkan gas. [Panduan resmi, bagian verifying](https://barretenberg.aztec.network/docs/how_to_guides/how-to-solidity-verifier/).

Rekomendasi desain: pisahkan transaksi anchor/endorsement batch dari pemeriksaan receipt yang bisa diulang. Publikasi proof atau hasil persisten dapat menjadi kebutuhan terpisah. **Masih perlu penegasan makna Q21**: verifikasi independen memakai deployed verifier, atau hasil tiap proof wajib tercatat dalam transaksi. Keputusan menerima verifier aktual belum otomatis memilih opsi kedua. Client harus mengetahui chain, alamat dan versi verifier/root registry yang benar; jawaban server tanpa sumber tersebut belum menjadi verifikasi independen.

## Pembanding Groth16 dan asumsi kepercayaan

[Rilis resmi Circom](https://github.com/iden3/circom/releases) menampilkan 2.2.3; [rilis snarkjs](https://github.com/iden3/snarkjs/releases) menampilkan 0.7.6. Alurnya adalah circuit/R1CS + witness, ceremony/key, proof, lalu export Solidity verifier dan calldata. Groth16 membutuhkan setup fase kedua khusus circuit di samping Powers of Tau; berkas awal tanpa kontribusi tidak boleh dianggap key produksi. [README snarkjs](https://github.com/iden3/snarkjs) juga mencatat keterbatasan worker threads pada Bun. Untuk PoC backend, proses Node terpisah yang dipin adalah opsi yang perlu diuji, bukan mengasumsikan semua library langsung cocok dengan runtime aplikasi.

Template [verifier Groth16 resmi](https://github.com/iden3/snarkjs/blob/master/templates/verifier_groth16.sol.ejs) melakukan pemeriksaan public signals dan pairing precompile. Ini kandidat pembanding nyata, tetapi riset ini tidak membuktikan bahwa hasilnya lebih murah atau lebih cepat untuk statement pilot.

Jangan memasarkan jalur Honk sebagai “tanpa trusted setup”: dokumentasi [SRS Barretenberg](https://barretenberg.aztec.network/api/namespacebb_1_1srs) menyebut BN254 trusted-setup CRS. Bedakan CRS bersama tersebut dari ceremony Groth16 khusus circuit; catat sumber, integritas dan asumsi CRS sesuai backend terpilih. Audit komponen juga tidak menjadi audit aplikasi: [catatan resmi Aztec](https://forum.aztec.network/t/alpha-upgrade-is-ready-for-proposal/8511) membahas hardening sejumlah komponen, bukan circuit receipt, encoding leaf, registry institusi, atau wrapper proyek ini. Cakupan dan versi audit harus diperiksa tersendiri.

## PoC yang menentukan kelayakan

Rekomendasi berikut merupakan desain/acceptance checks untuk keputusan pilot, bukan fitur yang sudah tersedia:

1. Tentukan leaf/commitment, randomness berentropi tinggi, encoding field dan domain. Witness memuat kontribusi dan Merkle path privat. Statement publik mengikat root, identitas institusi/batch/versi, dan commitment receipt yang sedang diperiksa. Tentukan atribut apa yang boleh terlihat; hash data berentropi rendah saja tidak menjamin privasi.
2. Wrapper memeriksa root yang benar-benar diendors oleh institusi berwenang dan kebijakan revisinya. Raw verifier dapat menerima proof valid untuk root buatan penyerang bila aplikasi tidak memeriksa otoritas root. Sukses hanya membuktikan membership terhadap batch tersebut, bukan kebenaran peristiwa bank atau penyerahan fisik.
3. Buktikan receipt sah diterima; proof rusak, leaf/path salah, root salah, institusi/batch/versi/domain salah dan penukaran receipt ditolak. Uji juga root tanpa endorsement walaupun proof matematisnya valid. Verifikasi sah harus tetap berhasil ketika diulang; membaca receipt tidak membakar nullifier klaim bantuan.
4. Jalankan witness → proof → generated Solidity verifier → wrapper dengan artefak yang dipin. Simpan checksum source circuit, compiler/prover, key/CRS, verifier, ABI dan contoh input; bangun ulang di lingkungan bersih. Verifikasi lokal saja tidak cukup membuktikan integrasi EVM.
5. Ukur runtime bytecode, proof/calldata size, gas eksekusi, waktu/RAM backend dan concurrency untuk kedalaman batch realistis. Catat hardware, versi dan parameter. Pastikan witness tidak masuk log/publikasi; backend proving berarti operator mengetahui data privat.

Jika Noir gagal memenuhi gerbang terukur, bandingkan circuit setara dengan Groth16 beserta beban ceremony dan pengoperasiannya. Jangan menurunkan Q19 menjadi mock atau hash anchor agar PoC tampak lulus.
