# Paper ZK dan Cakupan Pilot yang Disepakati

- Tanggal: 2026-09-16.
- Status: perbandingan sumber dan rekomendasi teknis; tidak mengganti keputusan Q17a/Q19.
- Arah yang diberikan pengguna: akses tamu per kontribusi; ZK nyata menjadi prioritas tinggi untuk membuktikan catatan kontribusi termasuk batch yang disahkan lembaga tanpa membuka identitas/nominal ke publik.
- Sumber: `archive/zk-private-zakat.tex`, PDF pendamping, circuit Noir arsip, kontrak/script, serta log benchmark repo. PDF dibaca melalui `pdftotext` karena `pdfplumber` tidak terpasang. Nomor halaman merujuk urutan halaman PDF.
- Batas: tidak menjalankan prover/benchmark, tidak mengakses chain, tidak memvalidasi klaim hukum atau syariah paper. Tidak mengubah paper maupun implementasi.

## 1. Paper menjadi landasan arah; statement pilot berbeda

Paper mengusulkan privasi zakat melalui proof atas predikat eligibility, commitment nominal, dan nullifier. Kontribusi utamanya adalah circuit yang menghitung kondisi nisab/hawl dan skema public/private donation. [Paper `.tex:51`](../../archive/zk-private-zakat.tex#L51), [`.tex:85`](../../archive/zk-private-zakat.tex#L85); [PDF](../../archive/zk-private-zakat.pdf), hal. 1–3.

Q19 memilih statement lain: **ada catatan kontribusi beserta pembukaan commitment dan jalur membership yang valid terhadap root batch berwenang**. Ini melanjutkan tujuan privasi/verifiabilitas paper dengan unit bukti pilot yang lebih terarah. Ini tidak menurunkan prioritas ZK menjadi pemeriksaan Merkle biasa; membership harus diperiksa di dalam circuit dan proof diperiksa verifier nyata.

| Aspek | Paper/circuit arsip | Statement pilot Q19 |
| --- | --- | --- |
| Yang diperiksa | Predikat pendapatan/aset/waktu dan commitment | Keanggotaan catatan kontribusi dalam batch yang disahkan lembaga |
| Sumber kepercayaan | Witness eligibility dan parameter yang diberikan | Root berwenang, identitas lembaga/batch/versi dan skema catatan |
| Informasi privat | Pendapatan, aset, awal hawl, secret, nominal | Identitas/nominal kontribusi dan witness lain sesuai spesifikasi privasi |
| Perilaku pengguna | Klaim/donasi dengan pencegahan penggunaan nullifier ulang | Receipt dapat dilihat dan diverifikasi berulang |
| Yang belum dibuktikan | Fakta dunia nyata di balik masukan | Pembayaran bank atau penyerahan fisik kepada mustahik |

Kolom pilot merupakan penjabaran teknis yang perlu dispec-kan, bukan klaim implementasi selesai.

## 2. Batas yang diakui paper sendiri

Bagian security dan limitations menyatakan:

- Verifier onchain saat itu **meng-anchor hash proof**, belum melakukan verifikasi kriptografis UltraHONK lengkap. Generated verifier dan hambatan ukuran kontrak masih pekerjaan lanjutan. [`.tex:228`](../../archive/zk-private-zakat.tex#L228), [`.tex:248`](../../archive/zk-private-zakat.tex#L248); PDF hal. 5.
- Proving melalui backend mengirim witness privat ke layanan tersebut; browser/WebAssembly masih rencana. Artinya privasi terhadap publik tidak otomatis menjadi privasi terhadap operator prover. [`.tex:159`](../../archive/zk-private-zakat.tex#L159); PDF hal. 3–4.
- Nominal private donation tetap terlihat di calldata, alamat penerima merupakan public input, dan hubungan transaksi dapat dianalisis. Menyembunyikan field pada satu event tidak cukup untuk privasi menyeluruh. [`.tex:228`](../../archive/zk-private-zakat.tex#L228), [`.tex:234`](../../archive/zk-private-zakat.tex#L234), [`.tex:236`](../../archive/zk-private-zakat.tex#L236); PDF hal. 5.
- Delapan asnaf belum diimplementasikan; encrypted note disbursement belum tersedia; tidak ada proof onchain bahwa uang telah sampai ke mustahik. [`.tex:248`](../../archive/zk-private-zakat.tex#L248); PDF hal. 5.

Karena itu kalimat umum tentang sistem “verified” atau memenuhi tujuan desain harus dibaca bersama batas tersebut. Menempelkan hash, mengeluarkan event, atau memiliki alamat verifier tidak membuktikan verifier kriptografis sudah dijalankan. Pernyataan paper tentang DID sebagai solusi penerimaan bantuan juga belum disertai protokol konfirmasi fisik yang diimplementasikan dalam sumber yang diperiksa.

## 3. Apa tepatnya yang dilakukan circuit dan kontrak

`main.nr` memeriksa `income * 12 + assets < nisab_threshold` dan batas waktu terhadap `hawl_start`, kemudian menghitung `pedersen(secret, recipient_address, cycle_id)` serta `pedersen(secret, amount)`. `recipient_address`, threshold, waktu, cycle, dan expected nullifier bersifat publik. **Tidak ada input root batch kontribusi, jalur Merkle, atau pengesahan lembaga pada circuit ini.** [main.nr:7](../../archive/noir-circuits/zkat_eligibility/src/main.nr#L7), [main.nr:18](../../archive/noir-circuits/zkat_eligibility/src/main.nr#L18).

Circuit membuktikan predikat atas witness yang dimasukkan; ia tidak mengikat pendapatan/aset ke sumber institusional. Penilaian apakah predikat tersebut tepat secara syariah berada di luar inspeksi ini.

Nullifier yang bergantung pada secret pilihan prover belum dengan sendirinya membatasi **orang yang sama** menjadi satu klaim. Binding identitas/credential/secret perlu ditetapkan agar mengganti secret tidak menjadi identitas baru. Selain itu entrypoint `donateZK` menerima nullifier sebagai argumen terpisah tanpa pencocokan ke public input; `donateZKPrivate` meneruskan commitment dari indeks 6, tetapi tidak mencocokkan semua konteks transaksi dengan statement. [ZKTCore.sol:554](../../sc/src/DAO/ZKTCore.sol#L554).

Kode sekarang mempunyai verifier yang sengaja gagal tertutup: `HonkVerifier.verify` dan `ZKVerifier.verify` mengembalikan `false`. `anchorProof` hanya mencatat hash/nullifier; alias `isVerified` mengembalikan status anchor. Ini berbeda dari narasi deployment historis, dan tidak menjadi dasar menyatakan kontrak sekarang menerima proof palsu. [HonkVerifier.sol:50](../../sc/src/DAO/verifiers/HonkVerifier.sol#L50), [ZKVerifier.sol:53](../../sc/src/DAO/verifiers/ZKVerifier.sol#L53), [ZKVerifier.sol:89](../../sc/src/DAO/verifiers/ZKVerifier.sol#L89).

Untuk Q17a/Q19, melihat receipt bukan menghabiskan hak bantuan. Menyalin `spend(nullifier)` ke setiap pemeriksaan receipt akan menghalangi verifikasi ulang yang sah. Jika dibutuhkan pencegahan replay saat autentikasi akses, challenge/session harus dibedakan dari identitas receipt dan tindakan klaim sekali pakai. Ini rekomendasi desain, belum keputusan bentuk nullifier pilot.

## 4. Benchmark adalah bukti historis yang perlu direproduksi

Paper melaporkan rata-rata proving 270 ms, verification 10 ms, dan ukuran proof 8.384 byte dari lima run pada mesin Linux 16-core. Log `v9-benchmarks-v2.md` memuat angka yang sama dan daftar durasi; paper sendiri membatasi validitas pada satu mesin/testnet. Ini **atribusi terhadap paper/log**, bukan hasil pengukuran sesi ini atau janji performa smartphone/pilot. [`.tex:89`](../../archive/zk-private-zakat.tex#L89), [`.tex:163`](../../archive/zk-private-zakat.tex#L163), [v9v2:12](../../archive/benchmarks/v9-benchmarks-v2.md#L12); PDF hal. 3–4.

Ada perbedaan versi: log `v9-benchmarks-final.md` mencatat proving 240 ms dan angka gas private donation berbeda; angka paper mengikuti v9v2. Log transaksi terpisah hanya mencatat satu hash/blok dan gas `donateZK`, tanpa membuktikan verifier lengkap yang dipakai. Paper mengakui full verification belum tersedia, sehingga gas tersebut tidak boleh dipromosikan sebagai biaya integrasi verifier penuh Q19. [v9-final:12](../../archive/benchmarks/v9-benchmarks-final.md#L12), [v9v2:22](../../archive/benchmarks/v9-benchmarks-v2.md#L22), [sepolia-donatezk-gas.txt:1](../../archive/benchmarks/sepolia-donatezk-gas.txt#L1).

Pipeline lokal juga belum cocok untuk reproduksi langsung. Script memakai tool/circuit di `/tmp`, menyebut Barretenberg v4.2.1 sementara benchmark menyebut v5 nightly, mengisi expected nullifier nol, dan tidak memasukkan `amount` yang diwajibkan circuit arsip. Ia mengompilasi `zkt_bench`, bukan langsung package arsip `zkat_eligibility`. [GenerateZKProof.mjs:8](../../sc/script/GenerateZKProof.mjs#L8), [baris 54](../../sc/script/GenerateZKProof.mjs#L54), [baris 82](../../sc/script/GenerateZKProof.mjs#L82), [Nargo.toml:1](../../archive/noir-circuits/zkat_eligibility/Nargo.toml#L1). Path sementara dan artefak generated verifier yang disebut komentar tidak tersedia saat inspeksi; klaim ukuran verifier historis belum diukur ulang.

## 5. Implikasi implementasi Q19

Pertahankan ZK sebagai hasil wajib yang dipilih. Sebelum memilih toolchain, konkretkan leaf/commitment, sumber root sah, identitas batch/versi, dan apa yang dibuka kepada donatur serta publik. Root buatan penyerang dengan membership valid harus ditolak. Pengesahan root dapat diperiksa di batas verifier/aplikasi atau di circuit sesuai desain; membership sendiri tidak membuktikan kewenangan penerbit.

Tetapkan siapa menghasilkan proof dan siapa bisa melihat witness. Akses tamu per kontribusi tidak wajib menggunakan wallet; token akses adalah mekanisme izin membaca, sedangkan proof ZK adalah mekanisme membuktikan statement. Penguasaan receipt/secret tidak otomatis membuktikan identitas orang yang membayar.

Kriteria penerimaan minimum: proof nyata berhasil terhadap root berwenang; perubahan leaf/witness/root/konteks gagal; receipt dapat diperiksa ulang; sumber/versi batch bisa ditelusuri; tidak ada kebocoran identitas/nominal melalui public inputs, URL, log, atau metadata. Reproduksi benchmark harus memakai circuit membership yang benar-benar akan dipakai, bukan meminjam angka circuit eligibility.

Pilihan Noir/Circom, prover browser/server, lokasi verifikasi, dan bentuk pengesahan batch tetap perlu evaluasi. Paper memberi latar dan percobaan awal; implementasi Q19 membutuhkan circuit serta integrasi sesuai statement yang baru disepakati.
