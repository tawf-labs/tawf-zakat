# GoBarakah sebagai Pembanding E-Voucher untuk Pilot ZKT

- Tanggal akses: 2026-09-16.
- Status: riset pembanding untuk sesi `grill-with-docs`; bukan keputusan implementasi.
- Pertanyaan: bagian mana dari GoBarakah dapat membantu pilot penelusuran donatur dan pelaporan amil tanpa mengaburkan tanggung jawab Pengelola Zakat?
- Metode: halaman publik resmi. Tidak membuat akun, melakukan pembayaran, menguji aplikasi terautentikasi, atau menghubungi pihak lain. Beberapa jawaban FAQ tersedia melalui indeks pencarian meskipun pembukaan halaman hanya menampilkan judul pertanyaan.

## Temuan dari sumber resmi

### Cakupan dan perjalanan donatur

Situs yang dimaksud adalah [GoBarakah](https://www.gobarakah.com/). Mereka menawarkan e-voucher berkategori penggunaan, dikirim melalui WhatsApp/email kepada penerima atau wakil berwenang, dengan perlindungan OTP. Platform menawarkan penggalangan sekaligus distribusi, atau distribusi saja memakai dana yang sudah tersedia. Donatur menentukan nilai, jumlah, dan kategori voucher; pembayaran tersedia melalui perbankan daring, kartu, atau invoice. Donasi dapat menuju program, yang memilih penerima, atau individu melalui kode publiknya. Ini adalah deskripsi produk perusahaan, bukan hasil verifikasi operasional independen. [Beranda resmi](https://www.gobarakah.com/).

### Kepemilikan, penebusan, dan pembayaran vendor

Voucher dikelola pemilik program, ditetapkan kepada penerima, dan ditebus sesuai kategori. Donatur tidak mempertahankan kepemilikan setelah pembelian. Vendor menerima pembayaran atas penebusan; ketentuan menyebut T+1 hari kerja dari tanggal penarikan, bukan otomatis sehari setelah donasi. Formatnya mencakup sekali pakai, penebusan sebagian, dan nilai nol. Pemilik program menetapkan kedaluwarsa. Voucher yang belum digunakan dapat dialihkan menurut syarat tertentu. Ini perlu dibedakan dari sekadar tanda terima donatur. [Ketentuan penggunaan, §2–3](https://www.gobarakah.com/terms-conditions-of-use).

### Interaksi penerima, organisasi, dan pelaporan

Penerima membuka voucher, dapat memindai QR vendor, memasukkan nominal, mengonfirmasi penebusan, lalu menunjukkan barcode kepada kasir. Bantuan tunai mengikuti proses dan vendor yang ditetapkan; halaman publik belum menjelaskan seluruh langkah pencairan akhirnya. Organisasi dapat mendaftarkan atau mencalonkan penerima sendiri maupun memakai daftar penerima yang tersedia, serta melihat penetapan voucher, penerima, nilai, saldo, status/tanggal penebusan, dan vendor. Donatur mendapat laporan alokasi/distribusi. Ketersediaan vendor merupakan prasyarat praktis: FAQ mengarahkan pengguna menghubungi dukungan jika tidak ada lokasi terdekat. [FAQ resmi](https://www.gobarakah.com/faq-1).

Halaman program tertentu juga membedakan total voucher terjual dan total ditetapkan, serta menyebut email ketika sumbangan telah dikirim kepada penerima. Status tersebut tidak dengan sendirinya menyatakan barang sudah diserahkan. [Contoh program resmi](https://donate.gobarakah.com/purchase/program/gobarakah-smart-giving-direct-impact-connecting-your-donations-directly-to-those-who-need-it-most-one-e-voucher-at-a-time).

### Batas negara dan kepastian informasi

Ketentuan penggunaan yang terbaca menyebut penduduk Malaysia dan perusahaan Malaysia. Beranda menautkan **GoBarakah Indonesia (Beta)**; alamat beta gagal dibuka oleh alat riset, sehingga cakupan Indonesia belum terverifikasi. Ini tidak membuktikan layanan Indonesia belum ada. Ketentuan dan footer juga memakai nama badan usaha berbeda; hubungan atau pembaruannya tidak diteliti. Pola produk bisa menjadi inspirasi, tetapi pengaturan operasionalnya tidak otomatis berlaku bagi ZKT. [Ketentuan penggunaan](https://www.gobarakah.com/terms-conditions-of-use), [beranda](https://www.gobarakah.com/).

## Implikasi untuk ZKT — analisis, belum keputusan

Pembanding ini memperlihatkan dua pilihan penyaluran yang harus dibedakan dalam wawancara:

| Pilihan | Kejadian yang perlu dicatat | Konsekuensi pilot |
| --- | --- | --- |
| Petugas lembaga menyerahkan bantuan | Persetujuan, penyerahan uang/paket, konfirmasi penerima, bukti | Dapat dibangun di atas pengajuan dan realisasi lembaga |
| Penerima menebus bantuan pada merchant | Hak menebus, saldo, penebusan, penyerahan barang, penyelesaian pembayaran merchant | Memerlukan merchant, aturan penebusan, serta rekonsiliasi tagihan/pembayaran |

Keduanya dapat memakai hubungan pendanaan–bantuan–realisasi–bukti, tetapi bukan proses operasional yang sama. Kehadiran voucher sendiri tidak menentukan pilihan tersebut. Untuk model kedua, istilah **voucher** sebagai hak menebus lebih tepat dibanding sekadar penghubung laporan. Untuk model pertama, kode penerimaan dapat cukup; istilah dan mekanismenya masih perlu disepakati.

Hal yang layak diadaptasi adalah pemisahan status didanai, ditetapkan ke penerima, ditebus/diserahkan, dan dibayar kepada penyedia. Menggabungkannya sebagai satu status “selesai” akan menyulitkan penjelasan posisi bantuan. Penebusan sebagian juga mengisyaratkan kebutuhan mencatat realisasi per kejadian jika memang masuk pilot.

Mode distribusi dari dana yang sudah ada memberi opsi pilot yang tidak bergantung pada peluncuran penggalangan baru. Namun, pilihan ini belum diterima pengguna; diagram stakeholder dan hasil pilot tetap harus diuji bersama.

ZKT tetap mengikuti [CONTEXT](../../CONTEXT.md), [ADR-0016](../adr/0016-commercial-positioning-technology-vendor-not-licensed-amil.md), dan [ADR-0020](../adr/0020-institutional-pilot-evidence-and-reconciliation.md): teknologi serta bukti disediakan ZKT, pengelolaan dan penyaluran dana oleh lembaga. Jika ingin mengubah batas tersebut, perlu keputusan eksplisit; tidak dapat disimpulkan dari meniru antarmuka GoBarakah.

## Yang belum dibuktikan

- Struktur rekening penampung, pemegang kendali dana, dan seluruh proses settlement GoBarakah.
- Konfirmasi penerimaan fisik yang independen, pencegahan kolusi, dan penanganan sengketa.
- Apakah GoBarakah memakai NFT/blockchain; istilah aset digital tidak cukup untuk menyimpulkannya.
- Hubungan tepat satu donatur dengan satu penerima untuk semua program; contoh pembelian tidak membuktikan aturan universal tersebut.
- Perilaku tanpa koneksi, tanpa telepon pribadi, dan delegasi penerimaan secara rinci.
- Dampak terukur terhadap waktu laporan amil atau kecocokan dengan format pelaporan ZKT.

Pertanyaan lanjutan paling menentukan adalah siapa menyerahkan bantuan pada pilot: petugas lembaga atau merchant tempat penerima menebus. Jawaban itu mendahului desain OTP, NFT, dashboard, dan perubahan tiket.
