# Laporan periode yang ramah staf

- Status: **dikunci sebagai [ADR-0043](../adr/0043-laporan-periode-disusun-dari-data-aplikasi-pembukuan-opsional.md) pada 2026-10-02.** ADR yang mengikat; dokumen ini menyimpan rancangan alur dan pembagian tiketnya.
- Dasar: tinjauan layar *Bukti & laporan* 2026-10-02, ADR-0021/0022 (paket bukti dan registry), ADR-0042 (biaya operasional dan kunci periode), keputusan pengguna 2026-10-02:
  - pembukuan bendahara sebagai pembanding opsional;
  - cakupan awal penyaluran dan biaya operasional;
  - rancangan dan tiket disusun lebih dulu.

## 1. Keadaan sekarang

| Layar | Isi | Masalah bagi staf |
| --- | --- | --- |
| Siapkan snapshot (`EvidencePreparationForm`) | Selalu terbuka di atas daftar. Dua sisi rekonsiliasi: klaim (JSON/USDC) dan sumber (realisasi, spreadsheet, JSON). Pilihan unit mata uang dan "On/Off balance sheet". Input berkas bawaan browser, emoji di tombol. | Staf harus memahami klaim vs sumber, JSON, dan posisi neraca. Data penyaluran sebenarnya sudah ada di aplikasi. |
| Detail snapshot (`PreparationDetail`) | Manifest tiap sisi, cut-off UTC, format dan versi pemetaan, temuan berkunci (`klaim-1`), berkas provenance dengan SHA-256, commitment HMAC. | Sebagian besar hanya berguna bagi pemeriksa. |
| Pemulihan (`RecoveryPanel`) | "Konfirmasi blok bukan finalitas settlement L1", status chain. | Istilah teknis registry. |
| Laporan dari snapshot (`ReportPackageForm`) | Isian identitas laporan, versi, ID paket pendahulu, alasan koreksi, angka berkunci `CLAIM.ZAKAT.ON` / `SOURCE.DSKL.ON`, narasi, pernyataan, daftar paket berupa ID. | Staf harus mengarang identitas dan versi, menyalin ID paket, dan menebak arti kunci angka. |
| Pencatatan/penerbitan (`RecordingPanel`) | Retry id, digest, tanda tangan. | Alur penerbitan tidak terbaca sebagai satu langkah. |

## 2. Alur yang disepakati

Satu daftar laporan dan satu wizard. Pola visualnya mengikuti panel Penyaluran: kepala panel dengan ikon dan tab segmen, daftar lebih dulu, lalu tombol aksi bergaris.

### 2.1 Daftar laporan periode

- Satu kartu per laporan (periode + tahun): status *Draf*, *Siap diterbitkan*, *Terbit · versi N*, *Dikoreksi*, dan tanggal batas data.
- Tombol **Laporan periode baru**.
- Kartu terbit punya aksi *Lihat*, *Buat koreksi*, dan *Unduh paket pemeriksaan* (di Detail teknis).

### 2.2 Wizard laporan baru

1. **Periode.** Pilih *Semester I* atau *Akhir tahun* dan tahunnya. Batas data bawaannya *sekarang*, dengan penjelasan: "Data yang dicatat sesudah batas ini tidak masuk laporan dan tidak dianggap tidak ada." Rupiah dan cakupan neraca memakai nilai bawaan dan tidak ditampilkan.
2. **Data dari aplikasi.** Pratinjau dalam bahasa staf:
   - total disalurkan per jenis dana;
   - barang per satuan;
   - jumlah penerima;
   - biaya operasional (langsung dan dari panjar);
   - realisasi yang belum lengkap buktinya.
   
   Tombol **Kunci data laporan** membekukan snapshot.
3. **Bandingkan dengan pembukuan (opsional).** Unduh template rekap pembukuan, lalu unggah rekap bendahara.
   - Selisih per jenis dana ditampilkan sebagai kalimat, misalnya "Pembukuan mencatat Rp250.000 lebih besar untuk Zakat Mal."
   - Tombol **Lewati** tersedia. Laporan tanpa pembanding menyatakannya di batas pemeriksaan.
4. **Tinjau dan tulis laporan.**
   - Angka laporan tampil hanya-baca dengan label manusiawi, tanpa kunci `CLAIM.*`.
   - Batas pemeriksaan ditulis sebagai daftar kalimat biasa.
   - Narasi ditulis sendiri atau dengan **Bantu susun dengan AI**.
   - Ada pernyataan penyertaan sumber dan batas pemeriksaan.
   - Identitas laporan diisi aplikasi dari periode (mis. `laporan-penyaluran-akhir-tahun-2026`); versi dan pendahulu diisi dari riwayat terbit.
5. **Periksa dan terbitkan.**
   - Hasil pemeriksaan otomatis tampil sebagai *Lolos*, atau *Belum lolos* dengan alasan.
   - Tombol **Sahkan dan terbitkan** meminta tanda tangan akun pengesah lembaga, lalu menampilkan *Menunggu konfirmasi* hingga *Terbit*.
   - Pencatatan bukti draf yang ditolak tidak berada di alur utama.

### 2.3 Koreksi laporan terbit

*Buat koreksi* membuka wizard yang sama dengan pendahulu terisi otomatis. Alasan koreksi wajib. Langkah 4 menampilkan tabel *sebelum → sesudah* per angka. Baris biaya yang terkunci laporan (ADR-0042, #129) dikoreksi di tab Biaya operasional dengan pernyataan koreksi laporan.

### 2.4 Detail teknis

Bagian tertutup di tiap laporan, untuk pemeriksa:
- manifest dan cut-off UTC;
- commitment, digest, dan SHA-256 berkas;
- berkas provenance;
- vonis validator lengkap;
- status registry dan pemulihan;
- unduhan paket pemeriksaan.

Tidak ada yang dihapus; hanya dipindah.

## 3. Istilah

| Istilah teknis | Istilah staf |
| --- | --- |
| Snapshot, bekukan | Data laporan dikunci |
| Sisi klaim | Rekap pembukuan |
| Sisi sumber | Data dari aplikasi |
| Cut-off | Batas data laporan |
| Temuan, selisih bersih | Perbedaan dengan pembukuan |
| Paket laporan | Laporan (versi N) |
| Vonis validator LOLOS/DITOLAK | Hasil pemeriksaan otomatis: lolos / belum lolos |
| Pengesahan + penerbitan registry | Sahkan dan terbitkan |
| ID paket pendahulu | Versi yang dikoreksi |

## 4. Perubahan backend yang diperlukan

- **Laporan tanpa pembanding:** paket harus dapat dibentuk bila hanya data aplikasi yang ada. API pembekuan sudah menerima stream realisasi di sisi klaim maupun sumber. Tiket pertama memastikan bentuk yang jujur, yaitu kedua sisi dari stream realisasi atau sisi klaim yang meniru sumber. Pilihannya diberi catatan batas pemeriksaan "tidak dibandingkan dengan pembukuan", dan validator tetap memeriksanya.
- **Rekap pembukuan sebagai spreadsheet di sisi klaim:** pembaca tabular saat ini hanya untuk sisi sumber.
- **Ringkasan laporan per lembaga:** status, versi terbit, dan batas data per periode, agar daftar tidak perlu membaca registry per paket di browser.
- **Label angka laporan** yang manusiawi untuk setiap `figure.name`.

## 5. Di luar cakupan

- Penghimpunan (kontribusi Rupiah) sebagai sumber internal: tiket terpisah.
- Fitur auditor dan temuan pemeriksaan (ADR-0039).
- Rekonsiliasi antar-lembaga dan sumber USDC: tetap di API, tidak di alur staf.

## 6. Tiket

Diterbitkan sebagai issue GitHub dan dikerjakan berurutan:

1. #130 Daftar laporan periode, wizard langkah 1–2, dan Detail teknis.
2. #131 Tinjau, tulis, periksa, dan terbitkan (langkah 4–5).
3. #132 Bandingkan dengan pembukuan (langkah 3), termasuk spreadsheet di sisi klaim.
4. #133 Koreksi laporan terbit dengan wizard.
5. #134 Penghimpunan sebagai sumber internal laporan periode.
