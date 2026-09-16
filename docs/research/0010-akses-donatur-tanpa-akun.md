# Akses donatur tanpa akun

- Ditelusuri: 2026-09-16; sumber primer, pembacaan saja tanpa mengisi formulir atau mengirim pesan.
- Status: prinsip Q17a diterima pengguna — tanpa pendaftaran wajib, akses per kontribusi, akun riwayat opsional. Protokol autentikasi belum dipilih. Lihat [ADR-0033](../adr/0033-pilot-activity-allocation-confirmation-and-publication.md).
- Konteks: [Q6/Q11/Q17](0007-pilot-distribusi-dan-penelusuran-grilling.md) dan [CONTEXT](../../CONTEXT.md). Pilot dimulai dari kontribusi yang telah diterima lembaga; publik melihat agregat, donatur melihat kontribusinya dan progres kegiatan terkait, berkas penerima tetap terbatas.

## Kesimpulan

**Donatur tidak perlu diwajibkan mendaftar akun untuk menerima bukti dan mengikuti kegiatan.** Akses privat tetap dapat diperiksa melalui tautan terbatas atau kode sekali pakai pada kontak yang terkait dengan kontribusi tersebut. Catatan kontribusi, alamat pengiriman, sesi akses, dan akun donatur merupakan kebutuhan berbeda. Mengumpulkan kontak tidak harus berarti membuat profil login.

Ini rekomendasi desain berdasarkan contoh layanan dan prinsip akses berikut. Riset tidak menyimpulkan seluruh lembaga menggunakan pola yang sama, dan tidak menilai aturan hukum atau fikih.

## 1. Pola yang ditemukan pada layanan resmi

**Dompet Dhuafa secara eksplisit memperbolehkan donasi tanpa akun.** FAQ menjelaskan akun berguna untuk melihat riwayat dan status donasi. Artinya, pembayaran tamu dan portal riwayat dapat dipisahkan. [FAQ akun Dompet Dhuafa](https://digital.dompetdhuafa.org/faq/akun).

**BAZNAS menampilkan formulir nama, nomor handphone dan email**, beserta pilihan pembayaran, tanpa gerbang login pada halaman yang dibaca. Formulir menyebut pengiriman BSZ dan laporan melalui email. Panduan layanannya menyebut notifikasi dan BSZ melalui email/WhatsApp setelah pembayaran berhasil. Ini pengamatan halaman serta pernyataan resmi, bukan pengujian transaksi sampai selesai. [Formulir BAZNAS](https://bayarzakat.baznas.go.id/bayarzakat), [layanan pembayaran](https://baznas.go.id/layananpembayaran).

**Anonim kepada publik berbeda dari tidak dikenal lembaga.** Dompet Dhuafa menyatakan pilihan anonim menyembunyikan nama pada halaman campaign, sementara data tetap tersedia kepada pihak pengelola. Pola itu merupakan pembanding, bukan alasan mewajibkan identitas pada seluruh catatan historis ZKT. [FAQ donasi](https://digital.dompetdhuafa.org/faq/donasi).

Sebagai pembanding teknis, Stripe menyediakan URL receipt yang memiliki masa berlaku dan mekanisme pengiriman ulang ke email transaksi. Receipt dikirim untuk pembayaran berhasil. Ini menunjukkan akses satu bukti dapat berdiri sendiri; bukan rekomendasi memakai layanan tersebut atau menyalin durasinya. [Dokumentasi receipt](https://docs.stripe.com/receipts).

## 2. Pisahkan tiga pengalaman

Tabel ini merupakan usulan untuk ZKT berdasarkan Q11.

| Kebutuhan | Akses yang disarankan | Informasi |
| --- | --- | --- |
| Mengikuti kegiatan secara umum | Halaman publik tanpa akun | Progres dan hasil agregat yang memang boleh dipublikasikan |
| Melihat bukti kontribusi tertentu | Tautan/kode terbatas ke kontak terkait | Referensi, catatan kontribusi sendiri, alokasi dan progres kegiatan terkait |
| Melihat seluruh riwayat pribadi | Pilihan tambahan setelah hubungan identitas diperiksa | Kontribusi yang benar-benar berhak diakses pengguna, bukan seluruh catatan dengan nama mirip |

Riwayat menyeluruh belum perlu menjadi syarat pilot. Akun dapat ditawarkan kemudian sebagai kemudahan; jangan memaksa pendaftaran retroaktif agar kontribusi lama tetap tercatat. Akses satu kontribusi tidak otomatis memberikan akses ke semua kontribusi dengan nomor telepon/email yang sama.

## 3. Tautan dibanding kode sekali pakai

Dokumentasi Supabase membedakan klik magic link dan pemasukan OTP sebagai cara masuk tanpa password. Implementasi bawaannya dapat otomatis membuat pengguna baru, sehingga **passwordless tidak otomatis berarti tanpa akun**. Contoh tersebut membantu membedakan pengalaman dan model data, bukan pilihan vendor ZKT. [Dokumentasi passwordless](https://supabase.com/docs/guides/auth/auth-email-passwordless).

| Pilihan | Kemudahan | Batas dan konsekuensi desain |
| --- | --- | --- |
| Tautan rahasia dengan cakupan dan masa berlaku terbatas | Donatur membuka pesan lalu mengklik untuk melihat satu kontribusi | Penerima forward tautan dapat memperoleh akses selama masih berlaku; tautan bukan bukti identitas pribadi |
| Halaman referensi lalu meminta OTP ke kontak tercatat | Tautan halaman boleh diteruskan tanpa langsung memberikan akses privat | Memerlukan langkah dan pengiriman tambahan; kode tetap bisa dibagikan atau dibaca pengguna perangkat/kontak bersama |

**Rekomendasi awal:** tautan terbatas untuk satu kontribusi dengan informasi minimum; tukarkan token sekali pakai menjadi sesi terbatas agar pengguna dapat berpindah halaman. Setelah kedaluwarsa, sediakan pengiriman akses baru ke kontak yang telah terkait. Bila lembaga menghendaki agar forward tautan tidak cukup membuka detail, pilih OTP yang diminta saat membuka halaman. Keduanya membuktikan penguasaan kanal/token pada saat itu, bukan otomatis bahwa orang tersebut adalah pemberi dana asli.

Jangan menganggap OTP lewat kanal yang sama sebagai dua faktor. Durasi tautan/sesi dan rincian yang boleh ditampilkan masih perlu disepakati menurut pengalaman pilot; tidak ditentukan oleh angka default vendor.

OWASP menyarankan token acak yang sulit ditebak, penyimpanan aman, sekali pakai, kedaluwarsa, HTTPS, pembatasan percobaan dan perlindungan kebocoran melalui referrer. Sumber ini membahas pemulihan password; penerapannya pada akses kontribusi merupakan adaptasi prinsip keamanan token, bukan aturan khusus donasi. [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). Otorisasi terhadap objek yang diminta tetap diperiksa pada setiap permintaan, termasuk ketika ID kontribusi diubah. [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## 4. Pengiriman bukti tidak menetapkan kebenaran pembayaran

**Usulan alur pilot:** lembaga mengesahkan catatan kontribusi dari sumber yang dapat dipertanggungjawabkan, kemudian bukti/akses dikirim ke kontak terkait jika tersedia dan benar. Status pesan terkirim, dibaca, tautan diklik atau OTP benar tidak mengubah dana menjadi diterima. Status penerimaan dana dan status akses/pengiriman harus terpisah. Prinsip ini sesuai pemisahan klaim pembayaran berhasil dan pengiriman receipt pada [dokumentasi Stripe](https://docs.stripe.com/receipts), tetapi sumber penerimaan pilot ZKT tetap ditentukan oleh lembaga.

Catatan impor yang belum diperiksa tidak otomatis menghasilkan pesan “pembayaran berhasil”. Screenshot transfer yang dikirim donatur juga perlu dicocokkan dengan sumber lembaga; Dompet Dhuafa sendiri menjelaskan pencocokan konfirmasi dengan mutasi bank. [FAQ konfirmasi donasi](https://digital.dompetdhuafa.org/faq/donasi).

## 5. Data lama dan jalur pengecualian

Usulan penanganan sesuai pilot dana yang sudah diterima:

- **Kontak kosong atau pemberi tidak diketahui:** kontribusi tetap tercatat; tersedia progres publik. Jangan membuat alamat fiktif atau menjanjikan notifikasi personal.
- **Kontak salah/tidak aktif:** hentikan pengiriman ke tujuan itu; perbaikan melalui petugas dan bukti hubungan dengan transaksi. Nomor referensi saja tidak cukup mengubah tujuan akses.
- **Kontak bersama:** batasi akses sesuai kontribusi yang diotorisasi; jangan membuka seluruh riwayat hanya karena kontak sama.
- **Anonim publik:** nama tetap disembunyikan dari halaman publik; akses privat mungkin tersedia bila lembaga mempunyai kontak yang sesuai.
- **Tautan bocor/kedaluwarsa:** cabut akses lama bila perlu, lalu kirim ulang ke tujuan yang sudah diverifikasi; jawaban permintaan akses tidak membocorkan apakah seseorang pernah berdonasi.

Tidak ada alasan teknis untuk menyamakan “tanpa akun” dengan “semua rincian terbuka”. Untuk Q17, usulan prinsipnya adalah **bukti dikirim melalui kontak yang tersedia, penelusuran personal tanpa pendaftaran wajib, cakupan akses terbatas, dan riwayat akun opsional**.

**Keputusan setelah riset:** Q17a menerima prinsip tanpa pendaftaran wajib. Q27 kemudian memilih OTP ke kontak terkait sebelum rincian privat dibuka, dengan sesi terbatas; meneruskan tautan saja tidak cukup. Rekomendasi awal tautan/token di atas tetap menjadi catatan pembanding, bukan pilihan akhir. Kanal email/WhatsApp, durasi dan pemulihan kontak belum ditetapkan. Lihat [ADR-0033](../adr/0033-pilot-activity-allocation-confirmation-and-publication.md).
