# ADR-0021: Bukti Laporan Periode, Pengesahan Lembaga, dan Sumber Privat

- Status: Accepted — Q3–Q5 pada sesi `grill-with-docs`.
- Date: 2026-09-08.
- Decider: pengguna, melalui penerimaan seluruh rekomendasi putaran Q3–Q5.
- Extends: ADR-0020; batas stateless ADR-0017 keputusan 9 dan ADR-0018 keputusan 13 diperluas untuk paket bukti pilot.

Unit bukti utama pilot adalah **laporan periode beserta snapshot data sumber dan hasil rekonsiliasinya**. Lembaga mengesahkan catatannya, auditor memberikan hasil pemeriksaan secara terpisah, dan ZKT menjalankan layanan teknis. Publik mendapat ringkasan, status pemeriksaan, dan sidik digital dokumen; berkas identitas penerima serta rincian bank hanya tersedia bagi pihak berwenang.

## Alasan dan trade-off

[Riset pelaporan BAZNAS](../research/0002-baznas-pelaporan-audit-dan-ai.md) §5 dan §10 menempatkan asal angka, perbedaan antar-representasi, serta perubahan setelah cut-off sebagai masalah yang hendak diatasi. Paket periode mempertahankan kumpulan data yang benar-benar dipakai suatu laporan, sehingga pemeriksa dapat menelusuri kembali perhitungan tersebut. Rincian transaksi dipertahankan sejauh tersedia dalam sumber; pilihan ini tidak menjanjikan transaksi penyebab selisih ketika masukan hanya berupa rekap.

Alternatifnya adalah menjadikan pencatatan setiap transaksi individual sebagai unit utama pilot. Paket periode dipilih agar dapat digunakan terhadap pembukuan lembaga yang sudah ada dan rekap wilayah, tanpa mensyaratkan semua dana lebih dahulu mengalir melalui aplikasi ZKT.

Pengesahan lembaga dan pemeriksaan auditor membawa tanggung jawab berbeda. Atestasi atas paket tertentu harus dapat dibedakan dari opini audit keuangan atau pengawasan syariah resmi dengan cakupan lebih luas. Pemegang role teknis juga tidak otomatis membuktikan jabatan institusionalnya. Pasal 20 PerBAZNAS 1/2023 mengatur petugas, penanggung jawab, dan penetapan melalui SK; mekanisme tanda tangan kriptografis adalah pilihan desain ZKT, bukan metode yang diwajibkan pasal tersebut. [Teks resmi](https://peraturan.go.id/files/peraturan-baznas-no-1-tahun-2023.pdf).

Memisahkan ringkasan publik dari berkas terbatas menambah kebutuhan pengelolaan akses dan ketersediaan bukti. Sidik digital publik mengikat isi dokumen; pembaca yang berwenang tetap memerlukan akses ke berkas untuk memeriksanya. Hash identitas tidak melindungi identitas yang masih terbaca dalam lampiran.

## Batas perluasan dari v0

- Fitur v0 dalam ADR-0017/0018 tetap dideskripsikan sebagai hitung-dan-kembalikan. Paket bukti pilot menambah kebutuhan mempertahankan sumber dan hasil suatu pemeriksaan. Inti rekonsiliasi dan validator tetap dapat berupa fungsi murni.
- Penyimpanan snapshot diterima pada Q3. Kebijakan koreksi menjadi versi baru dicatat dalam [ADR-0022](0022-append-only-report-evidence-registry.md); skema penyimpanan, retensi, dan pelaksanaan migrasi masih perlu ditetapkan.
- Penolakan draf tetap berlaku. ADR-0022 menetapkan bahwa sumber dan hasil pemeriksaan yang menemukan selisih tetap disimpan tanpa memberi draf yang gagal status laporan lolos.
- Q8 memilih registry bukti terpisah dari vault melalui ADR-0022. Keputusan arsitektur ini belum menjadi kontrak yang dibangun atau dideploy.

Pertanyaan aktif dan bukti kemampuan aplikasi saat ini berada di [catatan 0004](../research/0004-smart-contract-project-fit-grilling.md). Perbaikan vault lama tetap dilacak menurut ADR-0020.
