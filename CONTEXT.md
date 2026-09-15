# ZKT — Bukti dan Rekonsiliasi Pengelolaan Zakat

ZKT adalah layanan teknologi bagi Pengelola Zakat untuk menelusuri bukti, merekonsiliasi catatan, dan memeriksa angka laporan. Pengelolaan serta penyaluran dana merupakan tanggung jawab lembaga.

## Language

### Pelaku

**Pengelola Zakat (PZ)**:
Lembaga pengelola zakat berizin, mencakup BAZNAS pusat, provinsi, kabupaten/kota, serta LAZ pada tingkatnya.

**Vendor teknologi**:
Penyedia layanan teknologi bagi Pengelola Zakat; dalam konteks proyek ini, ZKT menempati peran tersebut.
_Avoid_: Amil, pengelola dana zakat, jika yang dimaksud adalah tim penyedia teknologi.

**Muzakki**:
Pihak yang menunaikan zakat melalui Pengelola Zakat.

**Mustahik**:
Penerima zakat yang memenuhi kriteria asnaf.

**Amil operasional**:
Petugas lembaga yang menyiapkan pengajuan, catatan, dan bukti pengelolaan atau penyaluran dana.
_Avoid_: Auditor, DPS, untuk peran pelaksana operasional.

**Dewan Pengawas Syariah (DPS)**:
Pihak pengawas syariah lembaga yang menelaah kelayakan syariah sesuai penugasan dan SOP lembaganya.
_Avoid_: Pemberi persetujuan wajib untuk setiap pengajuan di semua lembaga.

**Pemeriksa pengajuan**:
Pihak yang memeriksa kelengkapan administrasi dan kelayakan pengajuan sebelum keputusan penyaluran.
_Avoid_: Auditor independen, untuk pemeriksaan operasional sebelum penyaluran.

**Pemberi persetujuan penyaluran**:
Pihak yang berwenang memutuskan pengajuan penyaluran sesuai SOP lembaga dan terpisah dari penyusun pengajuan tersebut.
_Avoid_: Administrator lembaga, hanya karena mengelola akun; DPS, sebagai jabatan universal untuk fungsi ini.

**Auditor Independen**:
Pihak yang memeriksa catatan dan bukti pengelolaan dana secara independen setelah kegiatan yang diperiksa berlangsung.
_Avoid_: Pemberi persetujuan operasional, untuk peran auditor.

**Ruang kerja lembaga**:
Lingkup kerja privat milik satu Pengelola Zakat pada aplikasi ini. Lembaga yang diwakili seorang pengguna ditentukan oleh keanggotaannya, bukan oleh isi permintaan.
_Avoid_: Tenant, workspace, dalam teks berbahasa Indonesia.

**Identitas akun lembaga**:
Nama dan keterkaitan akun dengan lembaga yang dikelola oleh administrator lembaga, dengan pembedaan akun orang dan akun bersama milik lembaga atau tim.
_Avoid_: Menganggap nama akun bersama sebagai identitas orang yang sedang bertindak; menganggap nama tampilan sebagai pemberian kewenangan.

**Akun kerja pribadi**:
Akun seorang petugas yang ditautkan ke lembaga untuk mengenali pelaku pekerjaan dan mencatat tindakannya.
_Avoid_: Akun bersama lembaga, sebagai bukti siapa petugas yang bertindak.

**Akun pengesahan lembaga**:
Akun yang mewakili lembaga dalam pengesahan, dicatat terpisah dari [[Akun kerja pribadi]] pelaku pekerjaan.
_Avoid_: Bukti identitas operator; bukti seluruh peserta pleno menandatangani secara digital.

**Peran ruang kerja**:
Kewenangan seseorang **di dalam** ruang kerja lembaganya. Tiga peran, disimpan sebagai `ADMIN`, `OFFICER`, dan `READER`:

- **Administrator lembaga** (`ADMIN`) — mengelola keanggotaan lembaganya. Administrator pertama ditetapkan lewat onboarding, tidak dicetak dari dalam aplikasi.
- **Petugas** (`OFFICER`) — [[Amil operasional]] dalam peran ruang kerja; menyiapkan dan mengubah bukti lembaganya.
- **Pembaca berwenang** (`READER`) — membaca sumber terbatas lembaganya, tanpa kewenangan membuat atau mengubah apa pun.

_Avoid_: Menyamakan peran ruang kerja dengan role kontrak. Keduanya terpisah: peran ruang kerja mengatur akses offchain, sedangkan pencatatan bukti dan penerbitan laporan diperiksa registry di rantai (ADR-0022). Keanggotaan pada basis data tidak pernah menjadi cadangan bagi role rantai yang tidak sah.

**Tantangan akses**:
Nonce sekali pakai yang diterbitkan server, mengikat tujuan aplikasi, akun, dan masa berlaku, lalu ditandatangani akun tersebut. Alamat yang disebut dalam permintaan bukan bukti identitas.
_Avoid_: Menyebutnya login atau password.

### Dana dan penyaluran

**Jenis dana**:
Kategori dana yang dibedakan dalam pencatatan dan pelaporan: Zakat, Fitrah, Infak/Sedekah, Kurban, dan Dana Sosial Keagamaan Lainnya (DSKL).
_Avoid_: Mata uang, asnaf, untuk dimensi jenis dana.

**Asnaf**:
Kategori penerima zakat: Fakir, Miskin, Amil, Muallaf, Riqab, Gharimin, Fisabilillah, dan Ibnu Sabil.

**Hak amil**:
Bagian dana untuk pengelolaan zakat oleh amil menurut kebijakan yang berlaku bagi dana dan lembaganya.
_Avoid_: Pendapatan ZKT, biaya langganan vendor.

**Program bantuan**:
Wadah kegiatan bantuan lembaga dengan tujuan tertentu yang dapat menaungi banyak [[Pengajuan penyaluran]].
_Avoid_: Pengajuan penyaluran, untuk keseluruhan program yang berjalan melalui beberapa pengajuan.

**Pagu referensi program**:
Nilai anggaran program yang menjadi acuan dan peringatan saat menelaah pengajuan; ketersediaan dananya dipastikan lembaga.
_Avoid_: Saldo bank terverifikasi; dana yang telah direservasi untuk pengajuan.

**Pengajuan penyaluran**:
Usulan penyaluran dalam satu [[Program bantuan]], disiapkan [[Amil operasional]] untuk satu atau banyak penerima beserta rincian bantuan, tujuan, dan bukti kelayakan yang akan ditelaah.
_Avoid_: Program bantuan, untuk satu usulan penyaluran di dalam program.

**Daftar penerima pengajuan**:
Rincian calon penerima dan bantuan masing-masing yang menjadi cakupan satu [[Pengajuan penyaluran]].
_Avoid_: Identitas penanggung jawab, sebagai pengganti seluruh identitas penerima; bukti bantuan telah diterima.

**Penanggung jawab pengajuan**:
Pihak yang bertanggung jawab atas kegiatan yang diajukan, dicatat tersendiri dari [[Daftar penerima pengajuan]].
_Avoid_: Mustahik, hanya karena namanya tercantum sebagai penanggung jawab.

**Perwakilan penerima**:
Wali atau pihak yang mewakili penerima bantuan, dengan hubungan dan dasar perwakilan yang dapat diperiksa.
_Avoid_: Pengganti identitas seluruh penerima dalam satu pengajuan.

**Penerima pembayaran**:
Pihak yang menerima pembayaran terkait bantuan, yang dapat berupa penerima manfaat, sekolah, atau penyedia yang dibayar untuk bantuan tersebut.
_Avoid_: Mustahik, hanya karena menerima transfer.

**Revisi pengajuan**:
Perubahan penerima atau rincian hak bantuan setelah pengajuan disetujui, dengan alasan dan persetujuan kembali serta riwayat sebelumnya yang tetap tersimpan.
_Avoid_: Menimpa realisasi yang sudah terjadi; koreksi laporan periode.

**Penutupan sisa bantuan**:
Keputusan lembaga beserta alasan untuk mengakhiri bagian bantuan yang disetujui tetapi tidak jadi disalurkan.
_Avoid_: Bukti penyaluran; pemindahan bantuan ke penerima lain tanpa persetujuan.

**Persetujuan DPS**:
Persetujuan syariah atas pengajuan penyaluran oleh DPS yang berwenang.
_Avoid_: Kuorum umum, persetujuan auditor, atau pengganti seluruh keputusan penyaluran lembaga.

**Persetujuan penyaluran**:
Keputusan [[Pemberi persetujuan penyaluran]] atas pengajuan yang telah diperiksa menurut SOP lembaganya.
_Avoid_: Bukti bantuan telah diserahkan; opini auditor.

**Penyaluran**:
Pemberian dana atau bantuan kepada penerima yang dituju.

**Realisasi penyaluran**:
Catatan pemberian bantuan yang benar-benar dilakukan, beserta penerima, jumlah uang atau barang, dan bukti yang mendukungnya.
_Avoid_: Nilai yang disetujui, sebagai bukti nilai yang sudah disalurkan.

**Penyaluran sebagian**:
Keadaan ketika sebagian bantuan yang disetujui telah disalurkan, sedangkan sisanya masih belum tersalurkan.
_Avoid_: Selesai, hanya karena sudah ada satu realisasi.

**Periode bantuan**:
Rentang yang menjadi cakupan pemberian bantuan kepada penerima.
_Avoid_: Periode pelaporan, jika yang dimaksud adalah cakupan bantuan atau klaim penerima.

### Bukti dan pemeriksaan

**Lapisan bukti**:
Bagian layanan ZKT yang mengikat catatan lembaga dengan bukti pendukungnya agar dapat ditelusuri dan diperiksa.

**Paket bukti laporan**:
Laporan periode beserta snapshot sumber dan hasil rekonsiliasi yang mendasarinya, sebagai satu cakupan pemeriksaan.

**Registry bukti**:
Catatan identitas paket bukti, pengesahannya, dan hubungan dengan versi serta atestasi yang dapat ditelusuri pemeriksa.

**Versi laporan**:
Bentuk laporan pada satu penerbitan beserta paket bukti yang mendasarinya.

**Koreksi laporan**:
Versi baru yang memperbaiki laporan sebelumnya, dengan rujukan ke versi tersebut, alasan perubahan, dan pengesahnya.
_Avoid_: Menimpa laporan, menghapus riwayat.

**Versi resmi terkini**:
Versi laporan yang saat ini diperlakukan registry sebagai berlaku, dan satu-satunya versi yang boleh disusul [[Koreksi laporan]].
_Avoid_: Versi terbaru menurut penomoran atau urutan penyimpanan; penomoran tampilan bukan sumber kewenangan.

**Garis resmi laporan**:
Rantai versi laporan dari [[Versi resmi terkini]] mundur melalui pendahulunya sampai versi pertama. Bercabang tidak mungkin: paling banyak satu penerus resmi per versi.
_Avoid_: Daftar seluruh paket laporan; pengajuan yang kalah tetap tersimpan sebagai bukti tetapi tidak berada pada garis ini.

**Atestasi versi laporan**:
[[Atestasi auditor]] atas satu [[Versi laporan]] tertentu pada registry bukti, beserta lingkup, kesimpulan, commitment bukti pemeriksaan, dan mandat auditornya. Dicatat di samping versi; tidak mengubah angka, pengesahan lembaga, atau vonis validator. Lingkup: `REKONSILIASI_PERIODE`, `SUMBER_DAN_KOMITMEN`, `TINDAK_LANJUT_TEMUAN`. Kesimpulan: `WAJAR_TANPA_PENGECUALIAN`, `WAJAR_DENGAN_PENGECUALIAN`, `TIDAK_WAJAR`, `TIDAK_MENYATAKAN_PENDAPAT`. Keadaan versi: `NOT_EXAMINED` sebelum ada atestasi, `ATTESTED` sesudahnya.
_Avoid_: Bukti independensi atau sertifikasi kepatuhan menyeluruh; kewenangan teknis dicatat oleh lembaga yang diperiksa. Atestasi penyaluran pada vault lama, yang merupakan jalur terpisah.

**Mandat auditor**:
Dasar penugasan yang dicatat lembaga ketika memberi kewenangan atestasi pada registry, beserta masa kewenangannya. Setiap perubahan mandat membatalkan material yang belum dieksekusi.
_Avoid_: Keanggotaan pembaca ruang kerja, yang tidak memberi hak atestasi.

**Tindak lanjut atestasi**:
Catatan auditor berikutnya yang menyusul catatannya sendiri pada versi yang sama. Menambah, tidak mengganti; kesimpulan sebelumnya tetap terbaca.

**Temuan pemeriksaan**:
Selisih atau masalah yang ditemukan ketika memeriksa catatan dan tetap menjadi bagian dari bukti pemeriksaan tersebut.
_Avoid_: Bukti lolos, untuk keberadaan catatan temuan.

**Tanggapan temuan**:
Penjelasan atau bukti tambahan yang disampaikan amil terhadap temuan auditor, dengan riwayat yang dapat ditelusuri dan tindak lanjut yang ditetapkan auditor.
_Avoid_: Perubahan otomatis atas transaksi, snapshot, atau atestasi yang telah tercatat.

**Snapshot sumber**:
Salinan tetap dari data dan bukti yang digunakan untuk menyusun atau memeriksa suatu laporan.
_Avoid_: Data terbaru, untuk sumber yang sudah terikat pada laporan tertentu.

**Persiapan bukti**:
Satu identitas yang mengikat [[Manifest sumber]], baris normalisasi kedua sisi, hasil rekonsiliasi, dan temuannya. Disimpan dan dibaca sebagai satu kesatuan; separuh persiapan bukan persiapan yang lebih kecil.
_Avoid_: Paket bukti laporan, sebelum ada versi laporan, pengesahan, dan registry yang mengikatnya.

**Manifest sumber**:
Keterangan yang menyertai satu sisi ledger: asal, lembaga/unit dan tingkat cakupannya, jenis dana, posisi neraca, unit mata uang, periode, cut-off, format, versi pemetaan, serta apakah rincian transaksinya tersedia.
_Avoid_: Judul berkas, untuk keterangan asal dan cakupan sumber.

**Keadaan sumber**:
Bagaimana suatu sumber menjawab ketika dibaca: `READ` (berhasil, boleh tanpa baris), `MISSING` (sumbernya belum ada), atau `FAILED` (dibaca dan gagal). Ketiganya berbeda; hanya yang pertama membuat angka nol berarti nol.
_Avoid_: Daftar kosong, sebagai jawaban atas sumber yang tidak terbaca.

**Sumber internal deposit USDC**:
Sisi ledger yang dibangun server dari deposit USDC protokol ini sendiri: baris ledger internal pada satu sisi, event `USDCDeposited` terindeks pada sisi lain. Jumlahnya integer satuan minor USDC_6DP dan identitasnya mengikat chain, kontrak, transaction hash, serta log index, sehingga beberapa deposit dalam satu transaksi tetap terpisah.
_Avoid_: Estimasi rupiah pada baris donasi USDC, sebagai jumlah deposit; menebak satuan dari besar angka.

**Identitas deposit**:
Chain, kontrak, transaction hash, dan log index satu deposit USDC, disimpan bersama barisnya dan dijaga unik oleh basis data. Dua deposit dalam transaksi yang sama dibedakan oleh log index, dan event yang diproses ulang jatuh pada baris yang sama.
_Avoid_: Transaction hash sendirian sebagai identitas; `trxId` acak yang membuat pemrosesan ulang menyisipkan baris kedua.

**Cakupan blok**:
Rentang blok yang benar-benar diperiksa satu sumber on-chain, beserta checkpoint indexer yang membatasinya. Dibekukan ke dalam [[Manifest sumber]]; deposit setelah checkpoint dinyatakan belum terperiksa, bukan tidak ada.
_Avoid_: "Sudah dibandingkan dengan chain", tanpa menyebut sampai blok berapa.

**Catatan belum terverifikasi**:
Catatan yang ada pada sumbernya dan tidak dapat dipasangkan dengan jumlah on-chain yang dapat dibuktikan. Ikut tersimpan bersama sisinya beserta alasannya, dan tidak masuk perbandingan.
_Avoid_: Menghilangkannya dari jumlah baris; menaksir jumlahnya dari kurs, estimasi rupiah, atau tanggal.

**Commitment paket**:
Nilai yang mengikat isi snapshot, dihitung dengan salt per snapshot sehingga sumber berentropi rendah tidak dapat ditebak dari nilainya. Salt merupakan material terbatas, bukan bagian [[Ringkasan publik]].
_Avoid_: Hash dokumen tanpa salt, sebagai mekanisme privasi.

**Pengesahan lembaga**:
Pernyataan pihak berwenang di lembaga atas catatan yang menjadi tanggung jawabnya.
_Avoid_: Atestasi auditor, vonis validator.

**Ringkasan publik**:
Bagian paket bukti yang dapat dilihat publik, berisi ringkasan laporan, status pemeriksaan, dan sidik digital dokumen.

**Dokumen terbatas**:
Berkas pendukung yang hanya dapat diakses pihak berwenang, termasuk identitas penerima dan rincian bank.

**Bukti pengajuan**:
Dokumen atau keterangan yang mendasari pengajuan dan penilaian kelayakan penerima.
_Avoid_: BAST, bukti penyaluran, untuk dokumen sebelum bantuan diserahkan.

**Berita Acara Serah Terima (BAST)**:
Dokumen yang menyatakan penyerahan dan penerimaan bantuan.
_Avoid_: Bukti pengajuan.

**Atestasi auditor**:
Pernyataan auditor mengenai hasil pemeriksaan catatan dan bukti pada cakupan tertentu.
_Avoid_: Persetujuan DPS, untuk pemeriksaan auditor setelah kegiatan.

**Durasi penyaluran**:
Lama tahapan pengajuan, persetujuan, penyaluran, dan atestasi yang dapat diukur dari jejak waktu kegiatan di dalam sistem.
_Avoid_: Jam kerja penyusunan laporan, untuk durasi tahapan penyaluran.

### Rekonsiliasi

**Rekonsiliasi**:
Pemeriksaan kesesuaian dua sisi catatan beserta selisih dan entri penyebabnya.
_Avoid_: Koreksi otomatis, vonis kepatuhan, untuk sekadar kecocokan angka.

**Sisi klaim**:
Angka yang dilaporkan dan diperiksa terhadap catatan pendukungnya.

**Sisi sumber**:
Catatan yang menjadi pembanding bagi sisi klaim.

**Selisih**:
Nilai sisi klaim dikurangi sisi sumber pada cakupan dan satuan yang sama.

**Posisi neraca**:
Pengelompokan catatan sebagai on balance sheet atau off balance sheet.

**Laporan Zakat Wilayah**:
Rekap Pengelola Zakat di suatu provinsi yang disusun BAZNAS Provinsi; menjadi sisi klaim dalam rekonsiliasi antar-lembaga.

**Laporan Kinerja**:
Laporan Pengelola Zakat yang mendasari rekap wilayah; menjadi sisi sumber dalam rekonsiliasi antar-lembaga.

**LPZN**:
Laporan Pengelola Zakat Nasional, publikasi BAZNAS yang menjadi salah satu sumber data pembanding dalam proyek ini.

### Laporan periode

**Periode pelaporan**:
Cakupan waktu laporan: semester pertama (1 Januari–30 Juni) atau akhir tahun (1 Januari–31 Desember).
_Avoid_: Periode bantuan.

**Angka periode**:
Angka yang dihitung dari catatan pada periode pelaporan dan menjadi acuan pemeriksaan draf.

**Daftar klaim**:
Pasangan nama angka dan nilai yang dinyatakan oleh sebuah draf laporan.

**Narasi laporan**:
Uraian tertulis yang menjelaskan angka periode kepada pembaca laporan.

**Vonis validator**:
Hasil pemeriksaan deterministik terhadap klaim, angka dalam narasi, dan kebijakan angka yang diperiksa: lolos atau ditolak.
_Avoid_: Opini auditor, sertifikasi syariah menyeluruh.

**Pengesahan layanan validator**:
Pernyataan layanan pemeriksaan bahwa paket laporan tertentu memperoleh vonis lolos berdasarkan aturan yang dinyatakan.
_Avoid_: Pengesahan lembaga, atestasi auditor, bukti kebenaran seluruh sumber.

**Penerbitan laporan**:
Penetapan suatu versi laporan sebagai terbit setelah pengesahan lembaga dan pengesahan layanan validator diterima untuk paket yang sama.
_Avoid_: Unduhan draf, pencatatan bukti pemeriksaan, untuk tindakan yang belum memenuhi pengesahan penerbitan.
