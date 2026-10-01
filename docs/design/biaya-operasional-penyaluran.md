# Biaya operasional penyaluran, talangan, dan panjar petugas

- Status: **dikunci sebagai [ADR-0042](../adr/0042-biaya-operasional-per-item-dengan-sumber-dana-dan-koreksi-berversi.md) pada 2026-10-01; #125, #126, dan UI #127 selesai, migrasi (#128) belum (lihat baris Implementasi di ADR).** ADR yang mengikat; dokumen ini menyimpan rincian dan alasannya. Fokus MVP adalah alur penyaluran; laporan keuangan tahunan dan pencatatan total hak amil dibahas terpisah.
- Dasar: wawancara Lazismu Tangsel ([catatan kasar](../research/LAZISMU.md)) dan diskusi lanjutan dengan pengguna; ADR-0039 (MVP tanpa auditor/DPS), ADR-0041 (penerbitan atas keputusan internal).

## 1. Keadaan sekarang

| Hal | Lokasi | Isi |
| --- | --- | --- |
| UI | `frontend/src/features/disbursement/AdvancesAndExpensesModal.tsx` | Modal dua form: "Uang muka petugas" (nominal, tujuan, referensi pertanggungjawaban) dan "Biaya operasional" (nominal, tujuan, **Payee**, **Dokumen rujukan**, uang muka terkait opsional). |
| Route | `backend/src/routes/disbursement.ts` `POST /proposals/:id/advances`, `/expenses` | Mandat `RECORD_REALIZATION`. Uang muka **selalu atas nama akun yang login** (`officerId` dari sesi); tidak ada pilihan petugas penerima. |
| Aturan | `backend/src/disbursement-store.ts` `recordExpense` | Biaya yang mempertanggungjawabkan uang muka tidak boleh melebihi nominal uang muka. Catatan hanya bisa ditambah: tidak ada edit atau hapus. |
| Bukti | — | Dokumen rujukan hanya teks; **berkas nota/kuitansi tidak dapat diunggah**. |
| Ringkasan | `backend/src/activity-store.ts` (akuntabilitas kegiatan) | Total biaya langsung, biaya atas uang muka, dan total uang muka. Tidak dihitung sebagai realisasi bantuan. |

Masalahnya: label "Payee" dan "Dokumen rujukan" membingungkan; tidak bisa menangani banyak petugas; daftar tidak menampilkan nama petugas; tidak ada pencatatan pengembalian sisa; tidak ada foto bukti.

## 2. Temuan lapangan

- **Pembayaran fleksibel, tetapi yang paling sering adalah talangan.** Petugas membayar dengan uang pribadi dulu, lalu diganti lembaga. Kadang-kadang dipakai panjar (petugas membawa uang lembaga). Kadang bendahara membayar langsung.
- **Struk kertas termal memudar.** Audit Lazismu pusat meminta struk, kuitansi, dan bukti transfer, sedangkan audit tahun 2025 masih berjalan. Foto bukti dibutuhkan agar tidak bermasalah saat diaudit.
- **Uang muka bukan gaji.** Honor petugas adalah biaya tersendiri (dibayarkan kepada petugas) yang bersumber dari hak amil.
- **Sumber dana biaya operasional (pemahaman pengguna, belum diverifikasi ke staf):** biaya operasional dibebankan ke porsi 20% dari infak, yaitu bagian hak amil yang dialokasikan ke dana program.
- **Batas hak amil menurut sumber regulasi:** maksimal 12,5% dari penghimpunan zakat dan maksimal 20% dari infak/sedekah/DSKL (KMA 606/2020; Peraturan BAZNAS 1/2016, yang menyebut porsi 20% dipakai bila hak amil zakat tidak mencukupi). Keduanya batas atas, bukan jatah tetap. Kemenag mengkaji ulang skema 12,5% dalam uji publik November 2025, belum ada perubahan angka. Dibaca dari ringkasan dan berita, belum dari teks peraturan; harus diverifikasi sebelum dijadikan aturan aplikasi.

## 3. Arah rancangan yang disepakati

1. **Pindah dari modal ke tab pada halaman pengajuan**, dengan grid ala Excel seperti daftar penerima (`SpreadsheetGrid`), plus tampilan kartu untuk HP.
2. **Grid untuk input, lalu kunci setelah dicatat.** Baris draf dapat diketik atau ditempel dari Excel. "Catat N baris" mencatat sekaligus dengan validasi per baris; baris yang gagal tetap sebagai draf dan ditandai. Baris tercatat terkunci; kesalahan diperbaiki dengan baris koreksi beserta alasan, bukan dengan edit. Sifat catatan yang hanya bisa ditambah ini dipertahankan demi jejak audit.
3. **Satu baris per item biaya** (sewa mobil, bensin, plastik), bukan satu baris per kegiatan.
4. **Nota terpisah dari baris.** Satu nota/kuitansi dapat menjadi bukti beberapa baris. Foto atau PDF dilampirkan ke nota, boleh lebih dari satu berkas, disimpan di penyimpanan berkas terenkripsi dengan sidik SHA-256 seperti bukti realisasi. Jika nota hilang, surat pernyataan menjadi pengganti.
5. **Tanpa kategori.** Kolom "Keperluan" berupa teks bebas, dengan saran dari isian sebelumnya agar lama-lama seragam. Pengelompokan untuk laporan tahunan dilakukan belakangan oleh bendahara (atau mengikuti daftar akun pusat jika ada), bukan oleh staf lapangan.
6. **Sumber dana per baris:** *Kas lembaga* · *Talangan petugas X* · *Panjar petugas X*. Uang muka tidak lagi menjadi form terpisah, melainkan salah satu sumber dana.
7. **Banyak petugas.** Petugas dipilih dari daftar Petugas & Akses, termasuk profil petugas tanpa akun login (petugas lapangan atau relawan yang tidak masuk ke platform). Siapa pun yang punya akses ruang kerja dan mandat pencatatan boleh mencatat panjar, talangan, dan biaya **untuk petugas lain**; biasanya admin menginput nota yang dikumpulkan. Pencatat tersimpan otomatis dan terpisah dari petugas pemegang talangan/panjar. Di atas grid tampil ringkasan per petugas: talangan belum/sudah diganti, serta panjar dengan jumlah terpakai dan sisanya. Tersedia aksi "Tandai sudah diganti" dan "Catat pengembalian sisa".

### Kolom grid biaya (usulan)

| Tanggal | Keperluan | Jml | Satuan | Harga | Total | Dibayarkan kepada | No. nota 📎 | Sumber dana |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 28/09 | Sewa mobil pick-up | 1 | hari | 300.000 | 300.000 | Rental Pak Udin | KW-012 📎 | Talangan Ahmad |
| 28/09 | Bensin | 10 | liter | 10.000 | 100.000 | SPBU 34.153 | STR-0457 📎 | Talangan Ahmad |
| 28/09 | Cetak foto dokumentasi | — | — | — | 25.000 | Fotocopy Jaya | NT-31 📎 | Kas lembaga |

Jml, satuan, dan harga bersifat opsional; jika ketiganya diisi, total dihitung otomatis. "Payee" berganti nama menjadi "Dibayarkan kepada", dan "Dokumen rujukan" menjadi "No. nota/kuitansi".

## 4. Di luar cakupan MVP

- Pencatatan total hak amil serta pemeriksaan batas 12,5% zakat dan 20% infak.
- Pemetaan keperluan ke daftar akun untuk laporan keuangan tahunan.
- Pembedaan sumber dana "hak amil zakat" dan "porsi infak" pada tiap baris biaya.

## 5. Pertanyaan terbuka

1. ~~Siapa yang boleh mencatat panjar?~~ **Terjawab 2026-10-01:** petugasnya sendiri maupun admin yang punya akses ruang kerja; tidak perlu mandat khusus bendahara.
2. ~~Bolehkah mencatat untuk petugas lain?~~ **Terjawab 2026-10-01:** boleh.
3. ~~Bentuk koreksi~~ **Terjawab 2026-10-01:** pilihan C, koreksi berversi (bagian 6).
4. Minta contoh LPJ atau rekap biaya Jumat Berkah / Kado Ramadhan ke staf Lazismu, dan tanyakan apakah pusat punya daftar akun baku.
5. Berapa lama bukti wajib disimpan untuk LAZ (aturan dokumen perusahaan umumnya 10 tahun, belum dipastikan berlaku untuk LAZ).

## 6. Bentuk koreksi (diputuskan: C)

Baris tercatat tidak boleh diubah diam-diam. Pilihannya:

| Pilihan | Cara kerja | Kelebihan | Kekurangan |
| --- | --- | --- | --- |
| **A. Pembalik penuh** | Baris salah dibalik dengan baris minus berikut alasannya, lalu baris benar diinput ulang. | Paling baku secara akuntansi (jurnal balik). | Satu kesalahan menjadi tiga baris; grid ramai dan membingungkan staf. |
| **B. Baris penyesuaian** | Ditambah baris selisih (+/−) yang menunjuk baris asal. | Cukup satu baris tambahan. | Nilai sebenarnya harus dihitung sendiri; salah nama toko, salah nota, atau salah petugas tidak bisa dinyatakan sebagai selisih. |
| **C. Koreksi berversi** (usulan) | Aksi "Koreksi" pada baris terkunci membuka isian lama, perubahan wajib beralasan, lalu baris menampilkan nilai terbaru dengan penanda "dikoreksi" dan riwayat yang bisa dibuka. "Batalkan baris" (mis. input dobel) adalah koreksi khusus yang menjadikan baris tidak berlaku. | Grid selalu menampilkan angka yang benar; berlaku untuk semua kolom; riwayat tetap utuh untuk auditor. Pola yang sama sudah dipakai koreksi kontribusi (alasan minimal 5 karakter, riwayat koreksi). | Implementasi paling banyak (penyimpanan versi per baris). |

Hal yang perlu dibatasi untuk pilihan mana pun: baris yang talangannya sudah ditandai diganti, atau yang sudah masuk laporan periode terbit, sebaiknya tidak bisa dikoreksi langsung.

