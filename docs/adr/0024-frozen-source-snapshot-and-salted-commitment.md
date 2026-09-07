# ADR-0024: Snapshot Sumber Dibekukan Sebelum Dihitung, dengan Commitment Bersalt

- Status: Accepted — diputuskan saat implementasi tiket #70 (Spec #68).
- Date: 2026-09-08.
- Decider: implementasi tiket #70, mengikuti ADR-0020–0022 dan batas ADR-0017 keputusan 9.
- Related: ADR-0017 (inti rekonsiliasi murni), ADR-0021 (paket bukti dan sumber privat), ADR-0022 (registry terpisah), ADR-0023 (akses ruang kerja).

Persiapan bukti **dibekukan menjadi byte kanonik lebih dahulu, lalu direkonsiliasi dari byte tersebut**, dan snapshot, hasil, serta temuan ditulis dalam **satu transaksi**. Commitment atas paket adalah **HMAC-SHA256 dengan salt 32 byte per snapshot** yang hanya tersedia pada paket akses terbatas. Dokumen sumber disimpan **terenkripsi** pada penyimpanan privat; tanpa kunci, berkas tidak disimpan sama sekali.

## Membekukan sebelum menghitung

Menghitung dahulu lalu menyimpan akan meninggalkan paket yang hasilnya diproduksi dari sesuatu yang sedikit berbeda dengan yang ia simpan, dan tidak ada cara membedakannya kemudian. Karena itu urutannya: normalisasi → serialisasi kanonik → **rekonsiliasi dari hasil parse byte kanonik** → simpan snapshot, hasil, dan temuan bersama.

Konsekuensinya, menghitung ulang dari snapshot yang tersimpan tidak dapat berbeda dari hasil yang tercatat di sebelahnya. Serialisasi kanonik menjadi bagian kontrak: kunci terurut, urutan array dipertahankan, jumlah uang sebagai teks angka desimal, dan bilangan pecahan ditolak alih-alih dibulatkan.

Alternatifnya adalah menyimpan snapshot dan hasil secara terpisah dengan pemeriksaan konsistensi menyusul. Itu menambah keadaan yang harus diperbaiki, sedangkan satu transaksi membuat separuh paket tidak pernah ada.

## Commitment bersalt, bukan hash biasa

Sebuah sumber dapat sangat kecil dan mudah ditebak: satu baris, angka bulat, lembaga yang sudah diketahui. Digest polos atas data seperti itu dapat dienumerasi siapa pun, sehingga bukan mekanisme privasi. Commitment karena itu berupa HMAC-SHA256 dengan salt 32 byte yang dibuat per snapshot.

Trade-off yang diterima: **salt adalah material terbatas**, jadi hanya pembaca berwenang yang dapat memverifikasi commitment. Itu memang pertukaran yang dimaksud — hanya mereka pula yang boleh melihat isi yang dikomitmenkan. Ringkasan publik memiliki digest SHA-256 sendiri karena isinya memang publik dan tidak ada yang perlu disembunyikan di balik salt.

Ringkasan publik disusun dengan **menyebutkan setiap field**, bukan dengan menghapus field dari paket privat. Teks bebas manifest, label, nama berkas, dan alasan kegagalan tetap terbatas; batas pemeriksaan publik dirakit dari enum tervalidasi. Ringkasan yang dirakit dengan pengurangan akan bocor pada saat pertama seseorang menambah field di hulu dan lupa berkas ini ada.

## Tiga keadaan sumber, bukan dua

Pembaca lama pada `db/index.ts` menjawab setiap pertanyaan dengan daftar, sehingga query yang gagal tidak dapat dibedakan dari periode yang memang kosong — dan laporan di atasnya menyebut keduanya `0`. `source-read.ts` memberi nama pada perbedaan itu: **READ** (berhasil, boleh kosong), **MISSING** (tidak ada sumbernya pada deployment ini), **FAILED** (dicoba dan gagal).

Endpoint `POST /api/reconciliation/internal` sebelumnya mengembalikan `balanced: true` atas populasi yang tidak pernah dibaca. Vonis itu kini ditahan (503) dan penyebabnya disebutkan per sumber. `POST /api/period-report/*` tetap mengembalikan angka dari apa yang terbaca, tetapi membawa `sources` dan `sourceWarning`; responsnya menyatakan cakupan mana yang belum diperiksa. Bila draf diberikan saat sumber belum lengkap, vonisnya `DITOLAK` dengan temuan `SUMBER_TIDAK_TERSEDIA`; klaim nol tidak dapat memperoleh vonis lolos dari sumber yang belum dibaca.

Pada paket bukti, sisi yang dinyatakan MISSING atau FAILED **tidak menghasilkan rekonsiliasi sama sekali**. Paketnya tetap disimpan — alasannya juga bukti — dengan outcome `INCOMPLETE`, bukan laporan seimbang atas populasi yang tak seorang pun periksa.

## Dokumen terbatas: terenkripsi atau tidak disimpan

Berkas sumber justru yang memuat nama, NIK, dan rincian rekening. Penyimpanan menulis ciphertext AES-256-GCM dengan nonce per berkas; kunci berada pada konfigurasi deployment. Tanpa `EVIDENCE_FILE_KEY`, berkas **tidak disimpan** dan barisnya dicatat `FAILED` beserta alasannya — menerima dokumen lalu menulisnya apa adanya jauh lebih buruk daripada menolaknya.

Locator penyimpanan bukan kontrol akses. Setiap pengambilan melewati otorisasi sesi, dan lembaga menjadi bagian dari `WHERE` pada query, sehingga mengganti id pada URL tidak menemukan baris apa pun. Locator tidak pernah muncul dalam respons.

Kegagalan adalah kegagalan: tidak ada CID sintetis, tidak ada status "tersedia" untuk berkas yang tidak ada. Berkas yang kemudian hilang dilaporkan tidak tersedia, dan commitment maupun waktu pencatatannya tidak diubah untuk menyamarkan hal itu.

## Batas

Rilis ini **tidak** memuat registry di rantai, pengesahan lembaga, pernyataan layanan validator, penerbitan laporan, atestasi auditor, maupun riwayat koreksi. Semuanya tetap seperti dinyatakan ADR-0022 dan menjadi tiket tersendiri di bawah Spec #68. Paket yang berhasil direkonsiliasi **bukan** laporan yang lolos, disahkan, atau diaudit; antarmuka dan wording pada `evidenceText.ts` menjaga pemisahan itu.

Adapter distribusi publik tidak digunakan pada rilis ini. Bila kelak ditambahkan, ia menerima byte yang sama dengan yang ditulis penyimpanan privat — sudah terenkripsi — dan kuncinya tidak ikut.

Kompatibilitas dengan ekspor SiMBA tidak diklaim dan tidak diuji; sumber ekspor lembaga lain diberi label `PARTNER_EXPORT`. Lembaga fixture tetap sintetis, dan identitas, mandat, serta akun penanda tangan mitra sungguhan masih merupakan data onboarding yang belum tersedia.

Konfigurasi, backup/pemulihan, batas impor, dan demonstrasi lokal: [operasional snapshot](../design/evidence-snapshot-operations.md).
