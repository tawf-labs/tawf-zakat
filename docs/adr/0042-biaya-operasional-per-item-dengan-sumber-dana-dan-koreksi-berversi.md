# ADR-0042: Biaya Operasional per Item dengan Sumber Dana dan Koreksi Berversi

- Status: Accepted — 2026-10-01, keputusan pengguna. Rancangan lengkap ada di [dokumen desain](../design/biaya-operasional-penyaluran.md).
- Implementasi: model data dan API selesai di #125 (2026-10-01). Nota/kuitansi dan surat pernyataan beserta berkas terenkripsi bersidik SHA-256 selesai di #126 (2026-10-01): berkas sebuah nota tidak dapat dihapus lagi setelah nota itu dirujuk baris biaya tercatat. Tab Biaya Operasional (#127, 2026-10-01) menggantikan modal uang muka: grid draf yang dicatat per batch, koreksi/batal/riwayat, lembar Panjar dan Nota, ringkasan per petugas, dan kartu di HP; nota yang nomornya diketik di grid dibuat otomatis saat baris dicatat. Migrasi data lama (#128) belum; catatan lama tampil hanya-baca di tab itu. Penolakan koreksi pada baris yang sudah tercakup laporan periode terbit belum ditegakkan, karena status terbit hanya terbaca dari registry on-chain.
- Related: ADR-0039, ADR-0041. Mengganti rancangan uang muka dan biaya operasional pada `AdvancesAndExpensesModal` (ticket #95).

Rancangan saat ini mencatat uang muka atas nama akun yang login, memakai label yang membingungkan ("Payee", "Dokumen rujukan"), tidak mampu menangani banyak petugas, dan tidak menyimpan foto bukti. Di Lazismu Tangsel, biaya kegiatan paling sering *ditalangi* petugas, kadang dibayar dari *panjar*, dan kadang dibayar langsung oleh bendahara. Petugas lapangan sering tidak punya akses ke platform, sehingga nota dikumpulkan lalu diinput admin. Struk kertas termal memudar, padahal audit dari Lazismu pusat membutuhkan struk dan kuitansi bertahun-tahun kemudian.

Keputusan:

1. **Satu baris per item biaya** (sewa mobil, bensin, plastik), diinput pada grid ala Excel di tab pengajuan. Baris draf boleh ditempel dari Excel; "Catat" memvalidasi dan mencatat per baris.
2. **Tanpa kategori.** "Keperluan" berupa teks bebas dengan saran dari isian sebelumnya. Pengelompokan untuk laporan tahunan bukan tugas staf lapangan.
3. **Sumber dana per baris:** kas lembaga, talangan petugas, atau panjar petugas. Uang muka tidak lagi menjadi form tersendiri. Talangan dilacak sampai diganti; panjar dilacak sampai sisanya dikembalikan.
4. **Petugas pemegang talangan/panjar dipilih dari profil petugas, termasuk yang tanpa akun login.** Siapa pun yang punya akses ruang kerja dan mandat pencatatan boleh mencatat untuk petugas lain, termasuk mengeluarkan panjar; tidak ada mandat khusus bendahara. Pencatat tersimpan terpisah dari pemegangnya.
5. **Nota/kuitansi berdiri sendiri** dan dapat menjadi bukti beberapa baris. Satu nota boleh memiliki beberapa foto atau PDF, disimpan terenkripsi dengan sidik SHA-256. Surat pernyataan menjadi pengganti jika nota hilang.
6. **Koreksi berversi.** Baris tercatat terkunci. "Koreksi" mengganti isian baris dengan alasan wajib: grid menampilkan nilai terbaru bertanda "dikoreksi", sementara versi lama, pengoreksi, waktu, dan alasan tetap tersimpan sebagai riwayat. "Batalkan baris" adalah koreksi khusus yang membuat baris tidak berlaku tanpa menghapusnya. Koreksi ditolak pada baris yang talangannya sudah diganti atau yang sudah tercakup laporan periode terbit.

Alternatif pembalik penuh (baris minus lalu baris pengganti) tidak dipilih karena satu kesalahan menjadi tiga baris dan membuat staf bingung. Alternatif baris selisih tidak dipilih karena tidak dapat mengoreksi kesalahan di luar angka, seperti pihak yang dibayar, nomor nota, atau petugas. Alternatif kategori biaya tidak dipilih karena staf lapangan ragu saat memilih, sehingga kategori cenderung jatuh ke "Lainnya".

Konsekuensi:

- Model data berubah: item biaya berversi, nota beserta berkasnya, sumber dana dengan petugas pemegang, status penggantian talangan, dan pengembalian panjar. Data uang muka dan biaya yang sudah ada perlu dimigrasikan atau dibaca sebagai jalur lama.
- Biaya operasional tetap tidak dihitung sebagai realisasi bantuan.
- Di luar cakupan: pencatatan total hak amil, pemeriksaan batas 12,5% zakat dan 20% infak/sedekah, serta pemetaan ke akun laporan tahunan. Pemahaman saat ini, yang belum diverifikasi ke staf, adalah bahwa biaya operasional dibebankan ke porsi 20% infak yang dialokasikan ke dana program.
