# Riset 0003 — Sumber Primer untuk Penyesuaian Smart Contract

- **Tanggal akses:** 2026-09-08.
- **Tujuan:** bahan `/grill-with-docs` untuk menilai kecocokan `ZakatProtocolL1` dengan posisi produk saat ini.
- **Status:** riset dan pertanyaan desain; belum menjadi keputusan produk, spesifikasi perubahan, audit keamanan lengkap, atau penetapan kepatuhan hukum/syariah.
- **Konteks internal:** [`CONTEXT.md`](../../CONTEXT.md), [ADR-0006](../adr/0006-separation-of-powers-dps-approval-and-ex-post-auditor-attestation.md), [ADR-0016](../adr/0016-commercial-positioning-technology-vendor-not-licensed-amil.md), [ADR-0019](../adr/0019-receipt-verified-governance-and-clean-redeployment.md), [riset 0002](0002-baznas-pelaporan-audit-dan-ai.md), dan [strategi komersial](../strategy/README.md).

**Pembacaan awal:** otorisasi Solidity belum sesuai ADR-0006. Perubahan selebihnya bergantung pada batas produk, jenis dana, arti penyaluran, dan kebutuhan gasless.

## 1. EIP-712: tanda tangan tidak otomatis menjadi otorisasi kontrak

**Fakta primer.** EIP-712 menetapkan hashing, signature terstruktur, dan pemisahan domain; secara eksplisit tidak menyediakan perlindungan replay. Aplikasi harus menolak pengulangan atau menjamin aksi idempoten. Domain dapat mengikat `chainId` dan `verifyingContract`. [EIP-712](https://eips.ethereum.org/EIPS/eip-712).

**Fakta repo.** [`ZakatProtocolL1.sol`](../../sc/src/ZakatProtocolL1.sol) mengotorisasi pemanggil melalui `msg.sender` dan role. Tidak ada entry point verifikasi signed intent, nonce signer, atau EIP-712 di kontrak ini. [ADR-0019](../adr/0019-receipt-verified-governance-and-clean-redeployment.md) sudah mengganti transport governance dengan transaksi wallet langsung.

**Inferensi.** Signature pada backend tidak memberi relayer kewenangan DPS di Solidity. Mengembalikan gasless memerlukan otorisasi delegasi yang diperiksa kontrak atau transaksi sah melalui akun pintar. Aksi, parameter, replay, masa berlaku, dan pencabutan role harus ditentukan. Alur manual tidak mensyaratkan perluasan ini.

## 2. Akun DPS Safe dan kuorum protokol adalah dua lapisan berbeda

**Fakta primer.** ERC-1271 menyediakan `isValidSignature(hash, signature)` bagi akun kontrak; nilai suksesnya `0x1626ba7e`. Validitas dapat bergantung pada state. Pemulihan alamat EOA saja tidak cukup. [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271).

Safe menyimpan owner dan threshold internal. Signature yang cukup mengizinkan transaksi standar; modul aktif memiliki jalur eksekusi tersendiri. [Safe Concepts](https://docs.safe.global/advanced/smart-account-concepts). Owner dapat berupa EOA atau akun ERC-1271. [Safe Signatures](https://docs.safe.global/sdk/protocol-kit/guides/signatures).

**Fakta repo.** `proposeDisbursement` langsung mencatat satu approval. `approveDisbursement` menerima admin, DPS, atau auditor; dua approval mencukupi. Dengan demikian, proposal admin kemudian approval auditor dapat lolos tanpa DPS. Ini bertentangan dengan keputusan **DPS wajib sebelum penyaluran, auditor sesudah penyaluran** dalam ADR-0006.

**Inferensi.** Safe 2-of-3 mewakili persetujuan satu akun DPS. Kontrak target tetap perlu mewajibkan DPS; memberikan role kepada Safe belum menutup jalur admin + auditor. Klaim kuorum harus diverifikasi pada konfigurasi Safe jaringan aktif.

## 3. Commitment fiat membuktikan catatan, bukan perpindahan uang bank

**Fakta primer.** Smart contract membutuhkan pemasok fakta eksternal; pengiriman data ke chain tidak otomatis menjamin keaslian dan ketepatannya. [Ethereum.org — Oracle problem](https://ethereum.org/developers/docs/oracles/#what-is-the-oracle-problem).

**Fakta repo.** `recordFiatBatchSettlement` menerima Merkle root dan total IDR dari relayer; tidak membaca saldo bank atau membuktikan total itu merupakan jumlah seluruh leaf. `executeDisbursement` untuk IDR hanya mengubah penghitung ledger. Jalur USDC berbeda karena benar-benar memanggil transfer token. Fungsi eksekusi juga tidak menerima BAST baru; event memakai kembali `ipfsProofCID` proposal. Sumber: [`ZakatProtocolL1.sol`](../../sc/src/ZakatProtocolL1.sol), fungsi tersebut.

**Inferensi.** Inclusion proof mengikat catatan ke batch, tanpa membuktikan pembayaran bank atau kelengkapan penerimaan. Timestamp blok menandai pencatatan, bukan waktu kejadian bank. Batas 12,5% IDR ditegakkan pada ledger; kontrak tidak mengendalikan transfer bank.

Vendor tanpa dana di rekening tim adalah **keputusan ADR-0016**. Kelanjutan vault USDC dan siapa pengendalinya memerlukan keputusan produk.

## 4. CID tidak memberikan privasi maupun ketersediaan otomatis

**Fakta primer.** Isi IPFS publik kecuali dienkripsi; enkripsi transport tidak menyembunyikan seluruh metadata. [IPFS — Privacy](https://docs.ipfs.tech/concepts/privacy-and-encryption/). Berkas dapat dienkripsi sebelum publikasi. [IPFS — Privacy practices](https://docs.ipfs.tech/how-to/privacy-best-practices/).

Persistensi membutuhkan node yang menyimpan data, misalnya melalui pinning. CID yang diketahui tidak dengan sendirinya memastikan masih ada node yang menyajikan berkas. [IPFS — Persistence](https://docs.ipfs.tech/concepts/persistence/).

**Fakta repo.** [Snapshot CONTEXT saat inspeksi](../../archive/CONTEXT-2026-09-08-before-pilot.md) menjelaskan hashing identitas mustahik dan unggahan dossier/BAST ke IPFS; Solidity menyimpan CID pada proposal dan event. Deskripsi gateway khusus dalam dokumen bukan bukti bahwa isi dokumen dienkripsi atau akses seluruh jaringan IPFS dibatasi.

**Inferensi.** Hash NIK tidak melindungi identitas yang terbaca pada berkas pendamping. Pemisahan dokumen pribadi, kunci, akses auditor, retensi, dan pinning terutama urusan penyimpanan/backend. Solidity relevan bila commitment atau hubungan proposal–BAST–atestasi berubah. Keamanan unggahan aktual belum diperiksa.

## 5. Plafon hak amil harus memiliki ruang lingkup dana dan lembaga

**Fakta sumber primer.** PerBAZNAS 1/2016 adalah pedoman RKAT untuk BAZNAS pusat, provinsi, dan kabupaten/kota. Pasal 8, halaman PDF 9, membedakan:

- Dana zakat: hak amil maksimal 12,5% penerimaan zakat.
- Jika bagian tersebut tidak mencukupi, operasional dapat menggunakan alokasi infak/sedekah dan DSKL maksimal 20% penerimaan kategori tersebut.
- Dana CSR: mengikuti ketentuan peraturan terkait.

Sumber: [teks resmi PerBAZNAS 1/2016, BN 1846/2016](https://peraturan.go.id/files/bn1846-2016.pdf). Publikasi BAZNAS RI tertanggal 31 Maret 2026 masih menegaskan plafon 12,5%. [BAZNAS — Pengelolaan zakat yang amanah dan profesional](https://baznas.go.id/news-show/BAZNAS_Tegaskan_Komitmen_Pengelolaan_Zakat_yang_Amanah_dan_Profesional/3888).

**Batas verifikasi.** PDF terbaca; halaman status peraturan dan daftar PPID BAZNAS gagal diakses. Ini bukan konsolidasi seluruh aturan 2026. Jangan otomatis menerapkan ketentuan RKAT tersebut kepada semua LAZ/UPZ; periksa kewenangan dan kebijakan lembaga mitra.

**Fakta repo dan inferensi.** Kontrak membedakan **mata uang**, tanpa **jenis dana** zakat/infak/DSKL. Setiap penerimaan mengalokasikan `floor(amount × 1250 / 10000)` untuk amil. Alokasi tetap ini merupakan kebijakan tambahan terhadap plafon. Perluasan jenis dana harus didahului keputusan dasar pembagiannya.

## 6. Pertanyaan keputusan untuk sesi grilling

1. **Batas produk:** mengendalikan pencairan atau mengikat bukti dari sistem lembaga?
2. **Kewenangan:** pertahankan ADR-0006; siapa pemilik admin dan akun institusional pilot?
3. **Makna selesai:** siapa menyatakan fiat tersalurkan, berdasarkan bukti apa? Apakah transfer USDC membutuhkan pengakuan penerimaan terpisah?
4. **Jenis dana:** zakat saja atau infak/DSKL juga; 12,5% alokasi tetap atau batas realisasi?
5. **Operator:** gasless diperlukan pada pilot atau alur manual cukup?
6. **Privasi:** berkas publik yang mana; siapa memegang kunci, akses, dan retensi versi pribadi?

Tindak lanjut: pengguna menerima pilot lembaga dalam [ADR-0020](../adr/0020-institutional-pilot-evidence-and-reconciliation.md), lalu paket bukti periode, pengesahan lembaga/pemeriksaan auditor terpisah, serta ringkasan publik dengan berkas sensitif terbatas dalam [ADR-0021](../adr/0021-period-evidence-institutional-endorsement-and-private-sources.md). Koreksi dengan versi baru, penyimpanan temuan, registry terpisah, dan dua pengesahan untuk penerbitan diterima dalam [ADR-0022](../adr/0022-append-only-report-evidence-registry.md). Q9 menerima pengesahan lembaga beserta pernyataan lolos layanan validator atas paket yang sama, dengan kepercayaan pada perhitungan layanan tetap eksplisit. Riwayat keputusan ada dalam [catatan 0004](0004-smart-contract-project-fit-grilling.md); [rancangan registry](../design/period-evidence-registry.md) mencatat kebutuhan yang masih harus diperinci untuk implementasi.
