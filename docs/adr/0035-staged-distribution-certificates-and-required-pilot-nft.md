# ADR-0035: Sertifikat Tahap Penyaluran dan NFT Wajib dalam Pilot

- Status: Accepted — Q32, pilihan pengguna pada Q33, dan Q37–Q40 sesi `grill-with-docs`, 2026-09-16.
- Related: ADR-0022, ADR-0032–0034.
- Refines: ADR-0032/Q13a, dari NFT sebagai opsi menjadi fitur wajib pilot.

Bukti distribusi diterbitkan sebagai sertifikat per tahap penyaluran yang disahkan pejabat lembaga berwenang dan merujuk realisasi serta konfirmasi penerima yang sama dengan pekerjaan amil. Pengesahan dan rujukan versinya dicatat di blockchain agar penerbit, integritas dan status dapat diperiksa tanpa membuka berkas privat. Penerbitan tidak harus menunggu seluruh kegiatan atau laporan periode selesai. Koreksi mempertahankan versi lama dengan hubungan ke pengganti; sengketa tercermin pada status cakupan terkait.

Pengguna secara eksplisit memilih **NFT harus masuk pilot**, menolak rekomendasi menunda penerbitan token. NFT menjadi representasi sertifikat distribusi tersebut. Motif yang telah dinyatakan ialah bukti distribusi yang bisa diverifikasi. Keputusan ini tidak menetapkan kepemilikan NFT sebagai hak mengambil bantuan, hak atas dana, atau identitas donatur; pemegang, aturan transfer, dan hubungan token dengan versi sertifikat kemudian diputuskan melalui Q37–Q39 di bawah.

ZK keanggotaan kontribusi tetap berprioritas tinggi menurut ADR-0034. NFT distribusi dan proof kontribusi mewakili pernyataan berbeda, dengan sumber operasional yang saling ditautkan. Penerbitan NFT tidak memenuhi kebutuhan ZK dan tidak membuktikan blockchain mengamati penyerahan fisik. Keduanya tidak menggandakan nilai kontribusi maupun realisasi. Foto wajah, identitas, kontak dan dokumen penerima tetap terbatas menurut ADR-0032; donatur tetap tidak wajib memiliki wallet.

Q37 menetapkan akun lembaga sebagai pemegang NFT. Donatur mengakses sertifikat dan keterkaitannya dengan kontribusi tanpa wallet wajib; beberapa donatur pada kegiatan yang sama dapat merujuk sertifikat yang sama. Pemegang token tetap dibedakan dari operator pribadi dan pejabat pengesah.

Q38 menetapkan NFT tidak diperdagangkan atau dipindahkan bebas. Pemulihan akses melalui kewenangan lembaga mempertahankan penerbit, isi dan riwayat sertifikat dengan jejak yang dapat diperiksa. Keputusan ini tidak memberikan kemampuan pemindahan admin diam-diam. Mekanisme rotasi pengendali akun atau penerbitan pengganti harus diperinci dan diuji bersama pilihan standar; keduanya belum dipilih hanya karena prinsip pemulihan diterima.

Q39 menetapkan satu NFT untuk satu versi sertifikat dengan isi tetap. Koreksi menghasilkan NFT versi baru yang menautkan pengganti; NFT lama dipertahankan sebagai riwayat dan ditandai telah digantikan. Status sengketa serta keberlakuan diperiksa terpisah dari isi tetap sertifikat. Gambar NFT atau keberadaan token saja tidak cukup untuk menyatakan versinya masih berlaku.

Q40 menetapkan layanan berwenang menerbitkan NFT setelah pengesahan lembaga dalam batas anggaran layanan/pilot terpisah, tanpa potongan otomatis kontribusi atau kebutuhan gas donatur. Penerbitan baru dinyatakan berhasil setelah transaksi sukses dikonfirmasi; tertunda/gagal tetap terlihat. Kegagalan mint tidak membatalkan kejadian penyerahan, tetapi hasil NFT yang diwajibkan pilot belum terpenuhi. Penanggung jawab nyata, nominal anggaran dan batas operasional harus ditetapkan sebelum digunakan.

Konsekuensinya, penerbitan token, pemeriksaan penerbit/isi/status, operasi gagal atau tertunda, koreksi dan pemulihan menjadi bagian rancangan pilot. Standar token, kontrak, protokol pemulihan, pengikatan/penyimpanan metadata dan operasi teknis masih memerlukan spesifikasi serta pengujian. Pengesahan laporan periode tetap mengikuti ADR-0022. Belum ada perubahan kode, deployment atau tracker melalui keputusan ini.

Lihat [wawancara](../research/0007-pilot-distribusi-dan-penelusuran-grilling.md) dan [riset pembanding NFT](../research/0009-nft-untuk-bukti-distribusi-pilot.md).
