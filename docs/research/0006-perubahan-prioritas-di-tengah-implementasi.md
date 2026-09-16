# Riset: Perubahan Prioritas ketika Spec dan Tiket Belum Selesai

Catatan sumber: diagram dan percakapan pendamping telah dibaca saat riset. Berkas asal di `docs/temp` tidak tersedia dalam repositori ini; temuan dan keputusan yang dipakai dicatat dalam dokumentasi berikut.

- **Tanggal pemeriksaan:** 2026-09-16.
- **Status:** temuan riset dan usulan proses; belum merupakan keputusan penggantian scope.
- **Pertanyaan:** bagaimana menangani permintaan perubahan besar dari stakeholder saat implementasi rencana sebelumnya masih berjalan?
- **Batas:** meneliti pengelolaan perubahan. Kelayakan fitur atau breakthrough domain belum dinilai dalam riset ini.

## 1. Temuan sumber primer

### Tujuan dan scope perlu dibedakan

Scrum Guide membolehkan negosiasi scope saat pembelajaran bertambah selama Sprint Goal tetap terjaga dan kualitas tidak turun. Jika tujuan sprint sudah tidak relevan, Product Owner dapat membatalkan sprint. Product Owner bertanggung jawab atas urutan backlog; masukan banyak stakeholder tetap melalui penanggung jawab tersebut. Panduan juga membedakan Product Goal dari daftar pekerjaan yang berkembang untuk mencapainya. Ini memberi dasar membedakan perubahan cara mencapai tujuan dengan perubahan tujuan itu sendiri. Sumber ini mendefinisikan Scrum; penggunaan prinsipnya di proyek ini tidak berarti repo wajib mengadopsi Scrum atau mempunyai sprint. [Scrum Guide, November 2020](https://scrumguides.org/scrum-guide.html).

### Komitmen berjalan perlu perlindungan dan batas investasi

Basecamp memilih pekerjaan melalui forum pengambil keputusan, memberikan tim waktu yang terlindung dari interupsi, dan membatasi investasi tiap siklus. Ide baru biasanya menunggu kesempatan penentuan prioritas berikutnya; krisis nyata dapat menghentikan pekerjaan. Pekerjaan yang belum selesai juga tidak otomatis memperoleh perpanjangan: masalah dan pendekatannya diperiksa kembali sebelum investasi berikutnya. Praktik enam minggu adalah pilihan Basecamp, bukan durasi universal. [Shape Up, “The Betting Table”](https://basecamp.com/shapeup/2.2-chapter-08), halaman diperiksa 2026-09-16; tanggal pembaruan tidak tercantum.

### Permintaan solusi perlu dikembalikan ke masalah yang ingin diatasi

GOV.UK memulai discovery dengan pemahaman pengguna, tujuan, kendala, dan nilai penyelesaian masalah. Bila permintaan awal sudah berbentuk solusi, tim perlu menguji asumsi dan merumuskan masalahnya. Discovery memiliki tujuan dan kriteria selesai; hasilnya dapat berupa keputusan melanjutkan atau berhenti. Panduan menyebut 4–8 minggu sebagai durasi umum, tetapi secara eksplisit tidak menetapkan durasi baku. Panduan ini ditujukan bagi layanan pemerintah Inggris; durasi dan tata kelola persetujuan belanjanya tidak otomatis berlaku untuk ZKT. [GOV.UK, “How the discovery phase works”](https://www.gov.uk/service-manual/agile-delivery/how-the-discovery-phase-works), terbit 2016-08-04, diperbarui 2021-06-21.

### Uji ketidakpastian terpenting dengan prototipe secukupnya

Pada alpha, GOV.UK menyarankan pengujian asumsi paling berisiko. Prototipe tidak harus mencakup seluruh perjalanan pengguna atau seluruh transaksi: cukup bagian yang menjawab pertanyaan tersulit. Kode prototipe dapat dibuang dan tidak harus berkualitas produksi. Hasil percobaan menjadi dasar memilih ide yang layak dibangun lebih lanjut. Ini memisahkan bukti bahwa suatu ide layak dari komitmen membangun seluruh fitur. [GOV.UK, “How the alpha phase works”](https://www.gov.uk/service-manual/agile-delivery/how-the-alpha-phase-works), terbit 2016-08-04, diperbarui 2019-05-08.

### Prioritas baru harus disertai keputusan kapasitas

Kanban Guide meminta tim mengendalikan jumlah pekerjaan yang sudah dimulai tetapi belum selesai, serta memulai pekerjaan baru ketika ada kapasitas. Pekerjaan macet perlu dikelola secara aktif. Prinsip tersebut mendukung pembicaraan tentang pekerjaan mana yang dilanjutkan, dihentikan, atau ditunda ketika prioritas berubah. Guide tidak menetapkan angka WIP yang cocok untuk repo ini, dan bukan sumber kewajiban untuk menuntaskan semua pekerjaan lama terlebih dahulu. [The Kanban Guide, edisi Mei 2025](https://kanbanguides.org/the-kanban-guide/), diperbarui 2025-05-01.

### Hasil kecil yang terintegrasi membantu memeriksa arah

Shape Up menganjurkan penyelesaian satu bagian kecil yang dapat dicoba sejak awal, dengan menghubungkan antarmuka dan perilaku di belakangnya. Daftar komponen yang selesai secara terpisah belum menunjukkan apakah interaksi yang diinginkan benar-benar bekerja. Pendekatan ini membantu mendapatkan umpan balik sebelum investasi melebar. Sebuah demo awal tetap perlu dinilai sesuai cakupannya; demo interaksi bukan bukti seluruh persyaratan produksi sudah terpenuhi. [Shape Up, “Get One Piece Done”](https://basecamp.com/shapeup/3.2-chapter-11), diperiksa 2026-09-16; tanggal pembaruan tidak tercantum.

### Keputusan lama tetap berguna ketika diganti

Michael Nygard menyarankan pencatatan keputusan arsitektur beserta konteks, status, dan konsekuensinya. Ketika keputusan dibalik, catatan lama dipertahankan dan ditandai digantikan, dengan rujukan ke penggantinya. Status usulan dibedakan dari keputusan yang diterima. Ini menjaga alasan perubahan dapat ditelusuri oleh pengembang berikutnya. Penerapannya pada spec dan tiket adalah adaptasi proses; artikel tersebut secara langsung membahas ADR. [“Documenting Architecture Decisions”, Michael Nygard, 2011-11-15](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## 2. Sintesis untuk menilai perubahan

Bagian ini merupakan rekomendasi dari temuan di atas, bukan aturan resmi salah satu framework.

| Keadaan yang ditemukan | Respons yang layak dipertimbangkan |
| --- | --- |
| Tujuan lama masih bernilai; perubahan baru hanya menambah pilihan | Simpan sebagai kandidat prioritas, lalu urutkan terhadap pekerjaan yang sedang berjalan. |
| Tujuan tetap, tetapi cara atau batas fitur berubah | Catat perubahan spec dan dampak acceptance criteria/dependensi. Pertahankan bagian yang masih berlaku. |
| Tujuan lama kehilangan nilai atau bertentangan dengan kebutuhan baru | Putuskan perubahan arah secara eksplisit; dokumentasikan pekerjaan yang digantikan dan alasan berhentinya. |
| Nilai atau kelayakan arah baru masih belum jelas | Batasi discovery pada pertanyaan penentu; gunakan prototipe hanya bila diperlukan untuk menjawabnya. |

Pemilihan pekerjaan lama sebaiknya memakai **nilai yang masih tersisa, biaya penyelesaian dari sekarang, risiko pekerjaan ulang, dan biaya menunda kebutuhan baru**. Lamanya pekerjaan yang sudah dilakukan tidak cukup untuk membenarkan penyelesaian seluruh rencana.

Usulan catatan perubahan satu halaman: masalah dan pengguna terdampak; bukti kebutuhan; tenggat nyata beserta akibat keterlambatan; penanggung jawab keputusan; hasil minimum yang diterima; pekerjaan lama yang dilanjutkan/ditunda/diganti; asumsi belum terjawab; batas waktu penilaian dan tanggal keputusan berikutnya. Waktu awal satu atau dua hari untuk triase dapat berguna bagi tim kecil, tetapi merupakan pilihan kontekstual, bukan durasi discovery yang dijanjikan sumber.

Dokumen ini belum menetapkan apakah spec lama harus diubah atau diganti. Itu memerlukan pemeriksaan cakupan aktual, dependensi tiket, kondisi pekerjaan berjalan, dan keputusan stakeholder tentang hasil minimum.

## 3. Posisi ZKT saat pemeriksaan

Pengguna mengonfirmasi bahwa stakeholder meminta **fitur siap dipakai dalam pilot**, bukan sekadar demonstrasi. Tanggal target, lembaga peserta, ukuran pilot, dan pihak yang menerima hasil belum disebutkan. Karena itu belum ada dasar untuk menjanjikan tanggal penyelesaian atau menetapkan seluruh brainstorming sebagai scope pilot.

Sumber internal yang dibaca: [CONTEXT.md](../../CONTEXT.md), [peta tiket](../design/pengajuan-penyaluran-tickets.md), [riset keputusan sebelumnya](0005-pengajuan-penyaluran-dan-ux-grilling.md), ADR terkait, diagram dari riset teman pengguna, dan percakapan brainstorming (`research_temp.txt`). Berkas percakapan awalnya kosong lalu telah disimpan pengguna dan dibaca kembali. Pernyataan AI dalam percakapan merupakan bahan hipotesis, bukan bukti kebutuhan lembaga, kondisi kode terkini, atau ketentuan hukum/syariah.

**Klarifikasi pengguna berikutnya:** diagram merupakan kesimpulan riset temannya; nama `research_temp` hanya nama berkas asal. Diagram dipakai sebagai acuan arah baru, bukan dinilai sementara berdasarkan nama file. Percakapan pendamping memberi konteks; alternatif di dalam percakapan yang tidak tercantum pada diagram belum otomatis mengganti kesimpulannya. Pengguna juga meminta dukungan sembako dan uang tunai. [Pemetaan pekerjaan dan usulan traceability](../design/pilot-voucher-traceability-mapping.md) menindaklanjuti klarifikasi tersebut.

GitHub dibaca melalui `gh` pada 2026-09-16; URL hasil pembacaan mengarah ke `tawf-labs/tawf-zakat` meskipun remote lokal bernama `tawf-labs/zkt-hackathon`.

| Pekerjaan | Bukti saat diperiksa | Arti bagi perubahan prioritas |
| --- | --- | --- |
| [Spec #86](https://github.com/tawf-labs/tawf-zakat/issues/86) | OPEN, `ready-for-agent`; 13 tiket implementasi pada peta lokal | Komitmen lengkap belum selesai; perlu menyatakan bagian yang tetap berlaku jika arah berubah. |
| [#87](https://github.com/tawf-labs/tawf-zakat/issues/87)–[#91](https://github.com/tawf-labs/tawf-zakat/issues/91) | Kelimanya CLOSED; commit lokal mencakup akun pribadi, impor sumber, program/draf penerima, mandat, dokumen dan pemeriksaan | Pertahankan hasil sebagai kandidat fondasi. Kecocokannya dengan kebutuhan baru masih harus dinilai. |
| [#92](https://github.com/tawf-labs/tawf-zakat/issues/92)–[#99](https://github.com/tawf-labs/tawf-zakat/issues/99) | Kedelapannya OPEN dan masih `ready-for-agent` | Ada titik keputusan sebelum mengambil tiket berikutnya. Status OPEN tidak membuktikan tidak ada pekerjaan lokal lain. |
| Kode lokal | HEAD `0fecd6a`, implementasi #91; riwayat juga memuat perbaikan #87–#90 | Checkpoint lokal tersedia. Pemeriksaan ini tidak membuktikan kode sudah dipush, dideploy, atau dipakai mitra. |
| Bukti kesiapan | Komentar penutupan [#88](https://github.com/tawf-labs/tawf-zakat/issues/88) menyebut smoke browser belum dilakukan; beberapa tiket mencatat diagnostic typecheck baseline | CLOSED perlu dibedakan dari siap pilot. Celah verifikasi yang mengenai alur pilot harus ditriase dan dipenuhi. Hasil historis bukan pengujian ulang sesi ini. |

### Perubahan yang tampak pada bahan baru

Spec #86 memusatkan pekerjaan pada amil internal: pengajuan, keputusan, pencatatan realisasi IDR/barang, dan penelusuran laporan. Bahan baru menambahkan perjalanan donatur, campaign/voucher, atribusi donasi ke bantuan, konfirmasi penerima di lapangan, serta pelaporan kepada donatur. Itu indikasi perluasan besar; belum cukup bukti bahwa semua model lama harus diganti.

Percakapan juga bergerak dari satu donatur per voucher ke voucher dengan beberapa kontributor, dari OTP ke QR lalu usulan TOTP, serta dari koneksi wajib ke offline. Pilihan yang berubah ini perlu dibawa sebagai alternatif/pertanyaan dalam riset berikutnya. Kalimat persuasif AI seperti teknologi tertentu “non-negotiable” tidak menetapkan kebutuhan pilot. Riset ini belum memvalidasi klaim tentang keamanan OTP/TOTP, GPS, NFT, ZK, atau aturan zakat.

| Bahan baru | Hubungan dengan keputusan yang masih berlaku |
| --- | --- |
| Pencairan dana melalui sistem | **Jika berarti sistem mengeksekusi pembayaran**, bertentangan dengan [ADR-0026](../adr/0026-disbursement-workflow-design-scope.md) dan batas #86 yang hanya mencatat pembayaran di luar aplikasi. Makna “pencairan” harus dipastikan. |
| Foto/identitas penerima yang dapat dilihat donatur atau publik | **Jika membuka Dokumen terbatas**, bertentangan dengan [ADR-0021](../adr/0021-period-evidence-institutional-endorsement-and-private-sources.md) dan [ADR-0024](../adr/0024-frozen-source-snapshot-and-salted-commitment.md). Akses donatur belum otomatis sama dengan akses pemeriksa. |
| NFT per distribusi sebagai unit utama laporan | Perlu menentukan hubungannya dengan paket laporan periode dan registry pada [ADR-0021](../adr/0021-period-evidence-institutional-endorsement-and-private-sources.md)/[ADR-0022](../adr/0022-append-only-report-evidence-registry.md). Belum diputuskan sebagai tambahan atau pengganti. |
| Offline, portal pemohon, deduplikasi lintas lembaga | Memperluas batas yang secara eksplisit dikeluarkan dari #86. Tidak dapat dimasukkan sebagai detail implementasi kecil. |
| DPS sebagai pengesah universal | **Jika diwajibkan untuk setiap program/lembaga**, perlu membuka kembali [ADR-0028](../adr/0028-institutional-approval-and-partial-realization.md), yang mengikuti mandat dan SOP lembaga. |

Tabel ini menunjukkan keputusan yang perlu dibuka kembali, bukan persetujuan untuk menggantinya.

## 4. Rekomendasi untuk pekerjaan yang belum selesai

**Tahan pengambilan tiket baru dari #86 untuk penilaian perubahan yang singkat dan berbatas waktu; pertahankan hasil #87–#91.** Tidak ada alasan harus menuntaskan delapan tiket tersisa hanya karena sudah ditulis. Sebaliknya, gambar baru saja belum membenarkan penulisan ulang seluruh aplikasi. Keputusan berikutnya didasarkan pada kebutuhan pilot dan biaya pekerjaan dari sekarang.

Ini rekomendasi proses, belum perubahan tracker atau instruksi menghentikan pekerjaan pihak lain. Bila ternyata ada WIP setelah #91, catat branch/commit, tes terakhir, pekerjaan tersisa, dan biaya melanjutkan kembali. Selesaikan hanya bila hasilnya masih dibutuhkan dan biaya sisa kecil; pekerjaan yang asumsi dasarnya dipertanyakan dihentikan pada keadaan yang dapat dilanjutkan dengan jelas.

Triase awal berikut bersifat sementara, bukan urutan implementasi baru:

| Tiket | Perlakuan yang disarankan sebelum keputusan pilot |
| --- | --- |
| #87–#91 | Pertahankan kode dan riwayat; periksa reuse terhadap kebutuhan pilot. Jangan mengubah acceptance criteria historis agar seolah sudah memenuhi fitur baru. |
| #92, impor penerima | Nilai berdasarkan volume dan cara pendataan peserta pilot. Dapat tetap bernilai, tetapi bukan otomatis prioritas pertama karena nomor tiketnya berikutnya. |
| #93–#95, keputusan dan realisasi | Telaah lebih awal saat analisis dampak karena beririsan dengan persetujuan, pencairan, dan distribusi pada diagram. Jangan lanjutkan asumsi pembayaran lama sebelum makna alur baru jelas. |
| #96–#97, revisi dan unggah ulang | Pilih kebutuhan berdasarkan perubahan data yang akan terjadi di pilot. Jika fitur ditunda, nyatakan pembatasan operasional dan cara menangani koreksi yang diterima mitra. |
| #98–#99, sumber laporan dan pemeriksaan | Bandingkan keluaran wajib pilot: laporan donatur, laporan periode, dan pemeriksaan auditor mempunyai penerima serta kriteria berbeda. Keduanya tidak otomatis saling menggantikan. |

## 5. Urutan keputusan sebelum riset breakthrough mendalam

1. **Buat catatan perubahan satu halaman.** Isi hasil yang diminta stakeholder, pengguna/mitra pilot, tanggal dan konsekuensi keterlambatan, kapasitas tim, satu penanggung jawab prioritas, serta ukuran keberhasilan. Contoh metrik untuk disepakati: waktu menyusun laporan atau jumlah realisasi yang dapat ditelusuri tanpa input ulang. Jangan mengarang target numeriknya.
2. **Pisahkan permintaan wajib dari opsi solusi.** Kelompokkan setiap butir brainstorming menjadi kebutuhan stakeholder yang terkonfirmasi, dugaan masalah, alternatif teknologi, atau ide lanjutan. Pastikan siapa yang bisa mengonfirmasi masing-masing; teks AI tidak menggantikan keputusan mitra.
3. **Batasi penilaian awal.** Usulan satu–dua hari kerja adalah waktu untuk merumuskan keputusan dan pertanyaan riset, bukan janji menuntaskan validasi teknologi atau menyiapkan pilot. Pada batas waktu, putuskan apakah bukti cukup, perlu percobaan tertentu dengan batas baru, atau perubahan belum layak dikomitmenkan.
4. **Bandingkan pilihan secara nyata.** Pilihan A: lanjutkan #86 dengan perubahan terbatas; B: pertahankan fondasi dan ganti sebagian roadmap untuk pilot baru; C: ganti arah produk. Bukti saat ini mendukung menilai B terlebih dahulu, tetapi belum memilih implementasinya. Catat manfaat, pekerjaan yang tertunda, biaya sisa, ketidakpastian, dan alasan keputusan.
5. **Riset hanya pertanyaan yang menentukan pilihan.** Setelah hasil pilot jelas, riset breakthrough dapat memeriksa asumsi yang menentukan apakah alur dapat dipakai. Prototipe dapat dipakai sebagai alat pembuktian internal, sementara hasil akhir yang dijanjikan tetap fitur pilot.
6. **Tetapkan satu alur lengkap dan susun ulang tiket.** Tentukan awal/akhir alur, peserta, data masuk, keluaran yang diterima, serta cara menangani kegagalan yang relevan. Baru setelah itu tetapkan spec dan urutan implementasi berdasarkan dependensi nyata.

Stakeholder yang mempercepat prioritas perlu ikut menerima pekerjaan yang tertunda dan batas hasil pertama. “Secepatnya” diterjemahkan menjadi tanggal, cakupan, kapasitas, dan keputusan yang dapat diperiksa. Satu orang memutuskan prioritas akhir setelah mendengar kebutuhan stakeholder dan penilaian teknis; siapa orangnya belum ditetapkan pada sesi ini.

## 6. Cara mempertahankan spec dan tiket tanpa dua arah yang bertentangan

Untuk perubahan kecil yang masih mencapai tujuan #86, tambahkan revisi bertanggal pada spec dan perbarui tiket yang terpengaruh beserta skenario penerimaannya. Untuk perubahan besar seperti kandidat saat ini, siapkan spec penerus atau tambahan yang menautkan #86 dan menyatakan batas penggantian secara eksplisit.

Saat keputusan diterima, gunakan satu tabel cakupan: bagian lama → tetap dipakai / diubah / ditunda / digantikan → pemilik tiket → acceptance criteria baru. Tiket lama yang masih relevan cukup ditautkan kembali; jangan membuat implementasi ganda. Perbarui dependensi dan peta lokal bersama tracker. Label `ready-for-agent` pada tiket yang ditahan perlu disesuaikan agar agen berikutnya tidak mengambilnya memakai prioritas lama.

Tiket selesai tetap menyimpan hasil dan verifikasi pada scope historisnya. Tiket ditunda tetap terbuka dengan alasan serta pemicu peninjauan ulang. Tiket yang benar-benar digantikan dapat ditutup dengan alasan dan tautan penerus, tanpa mengklaim fiturnya selesai. Parent #86 tidak ditutup sebagai completed bila kriteria lamanya belum terpenuhi; jelaskan bagian yang tersisa atau digantikan. ADR diterbitkan atau ditandai superseded hanya untuk keputusan arsitektur yang benar-benar berubah; dokumen lama dipertahankan.

## 7. Arti “siap dipakai dalam pilot” untuk perencanaan ini

Scope pilot boleh kecil, tetapi alur yang dipilih harus dapat diselesaikan oleh pengguna mitra dalam kondisi pilot. Kriteria penerimaan perlu mencakup akun/peran nyata yang telah dikonfigurasi, data tersimpan dan dapat dibaca kembali, jalur gagal/retry yang relevan, keluaran laporan yang diterima mitra, serta penanggung jawab bantuan dan koreksi saat operasi. Jika lapangan memang tanpa koneksi, asumsi koneksi wajib menjadi keputusan penentu sebelum memberi janji pilot.

Pengujian lokal, penerimaan pengguna, dan deployment adalah bukti berbeda. Pemeriksaan ulang browser untuk alur impor #88 diperlukan bila alur tersebut masuk pilot; kegagalan baseline ditriase berdasarkan dampaknya, bukan disembunyikan oleh status CLOSED. Rincian kebutuhan uang nyata, penyimpanan, dan akses mengikuti pilihan scope nanti. Dokumen ini tidak menyatakan aplikasi siap pilot atau menetapkan checklist produksi universal.

**Hasil sesi ini:** riset proses dan rekomendasi tersimpan. Tidak ada perubahan kode aplikasi, ADR yang diterima, issue/label/dependensi GitHub, deployment, commit, atau push. Tidak menjalankan pengujian aplikasi karena perubahan hanya menambah catatan riset. Kelayakan breakthrough tetap menjadi tahap berikutnya; deadline dan batas pilot masih perlu dipastikan.

## 8. Penajaman setelah pembacaan strategi dan riwayat keputusan

Atas arahan pengguna, pembacaan dilengkapi dengan seluruh rangkaian ADR-0001–0030, riset 0001–0005 dan strategi komersial. [Bagian 0 peta pekerjaan](../design/pilot-voucher-traceability-mapping.md#0-koreksi-setelah-membaca-konteks-proyek-secara-menyeluruh) memuat rekomendasi terbaru. Prioritas perubahan perlu dinilai terhadap tujuan lapisan bukti, rekonsiliasi, kesiapan pemeriksaan dan pengurangan kerja ulang amil, sekaligus menghormati perluasan operasional yang sudah diterima melalui #86.

Usulan awal voucher sebagai satu hak bantuan diperbaiki: hak tetap berada pada pengajuan/rinciannya, sementara voucher menjadi penghubung pada alur campaign yang memerlukannya. Jalur sumber eksternal tetap bernilai tanpa voucher. #98 menjadi bagian penting hasil pilot; #99 tidak ditunda hanya karena tidak digambar pada alur donatur. Saran menahan seluruh tiket diperhalus menjadi menahan bagian yang asumsi dasarnya berubah, sambil menilai kelanjutan bagian yang tidak terpengaruh terhadap kapasitas pilot. Ini perubahan rekomendasi, belum perubahan keputusan produk atau tracker.
