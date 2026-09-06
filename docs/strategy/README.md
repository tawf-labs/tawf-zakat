# ZKT — Strategi Komersial, GTM, dan Roadmap

- **Untuk:** Ketua & tim inti
- **Tanggal:** 6 September 2026
- **Status:** Keputusan strategis sudah diambil dan dicatat di [ADR-0016](../adr/0016-commercial-positioning-technology-vendor-not-licensed-amil.md)
- **Dasar bukti:** [Riset 0002](../research/0002-baznas-pelaporan-audit-dan-ai.md) — 930 baris, sumber primer (UU/PP/PerBAZNAS + PDF laporan resmi BAZNAS), plus riset lanskap pasar 5–6 September 2026
- **Kredensial:** Juara 2, Rakornas & BAZNAS Awards 2025 (26–29 Agustus 2025, Jakarta, ±1.200 peserta se-Indonesia)

---

## 1. Ringkasan untuk Ketua

Tesis SaaS-nya **bertahan**. Yang berubah hanya tiga hal, dan ketiganya karena bukti yang sebelumnya tidak kita punya.

1. **Kita menjual *pembuktian*, bukan *pencatatan*.** SiMBA ternyata sudah menghasilkan 88 sub-laporan ber-PSAK 109, gratis dan wajib. Dua vendor komersial (ZAINS, SoftwareZakat.com) sudah menjual core system sejak lama. Ruang yang benar-benar kosong: **keteraudit-an** — hanya 15,9% pengelola zakat punya laporan keuangan teraudit.
2. **Kita ditagihkan dari hak amil, bukan mengambil bagian hak amil.** Sumber dananya sama persis. Posisi hukumnya berbeda total: yang pertama tidak butuh izin apa pun, yang kedua butuh izin LAZ dan badan hukum nirlaba.
3. **Ambisi jadi amil ditunda 24 bulan — tidak dibatalkan.** Bukan karena tidak berharga, tapi karena urutannya. Mengejarnya sekarang mengubah calon pelanggan menjadi pesaing sebelum kita punya satu pun pelanggan.

**Yang tidak berubah:** target komersial, segmen amil zakat, dan penggunaan aset teknis yang sudah dibangun (invariant hak amil, pemisahan peran DPS/Auditor, atestasi kriptografis).

**Angka yang perlu Ketua lihat:**

| | Jalur vendor (dipilih) | Jalur jadi amil |
| :--- | ---: | ---: |
| Pendapatan tahun 1 | Rp84 juta | Rp0 |
| Pendapatan tahun 2 | Rp810 juta | Rp0 |
| Pendapatan tahun 3 | **Rp3,38 miliar** | Rp0 — masih mengurus izin |
| Izin yang dibutuhkan | Tidak ada | Ormas Islam + badan hukum nirlaba + rekomendasi BAZNAS |
| Risiko pidana | Tidak ada | Pasal 37 & 38 UU 23/2011 bila urutannya keliru |

---

## 2. Dua Problem Statement

### Problem 1 — **The Cost of Compliance**

> *Reports are assembled manually after campaigns and once a year.*

**Bukti (semua dari publikasi resmi BAZNAS):**

| Temuan | Angka | Sumber |
| :--- | :--- | :--- |
| Laporan keuangan **teraudit** baru wajib masuk | **15 Agustus tahun berikutnya** — 227 hari setelah tutup buku | PerBAZNAS 1/2023 Pasal 13(3) |
| Laporan nasional terbit lebih dulu, dari angka **belum diaudit** | 15 Maret ke Menteri; *cut-off* data 27 Feb 2026 | PerBAZNAS 1/2023 Pasal 14(3); LPZN 2025 |
| Pengelola zakat yang punya dokumen laporan keuangan | **175 dari 748 (23,4%)** | LPZN 2025, Tabel 2.20 |
| Yang punya laporan keuangan **teraudit** | **115 dari 722 (15,9%)** | LPZN 2024, Tabel 2.29 |
| Selisih angka antar tabel dalam **satu dokumen resmi yang sama** | **Rp668 miliar** | LPZN 2024, Tabel 2.2 vs 2.3 |
| Nilai berbeda untuk pengumpulan 2024 yang sama | **Tiga versi** | LPZN 2024 & 2025 |
| Angka kepatuhan 2024 di-*restate* naik di publikasi berikutnya | 93,77% → 96,00%, tanpa catatan revisi | LPZN 2024 vs LPZN 2025 |

**Diagnosis.** Tidak ada sumber kebenaran tunggal yang mengikat. Setiap lapisan menyimpan salinannya sendiri — pembukuan internal, SiMBA, laporan cetak ke pemda, kertas kerja auditor — dan tidak ada mekanisme yang memaksa keempatnya konsisten. Rekonsiliasi dilakukan manual, belakangan, dan sebagian.

**Solusi kita.** *Evidence produced continuously, not assembled annually.* Bukti diturunkan dari ledger yang sudah terikat kriptografis, bukan dirakit ulang setiap akhir tahun. Selisih terdeteksi otomatis beserta transaksi penyebabnya.

---

### Problem 2 — **Borrowed Trust**

> *One scandal, and every institution pays.*

**Bukti:**

| Temuan | Angka | Sumber |
| :--- | :--- | :--- |
| Dugaan penyelewengan BAZNAS Jabar | **Rp13,3 miliar** (2021–2023) | Kejati Jabar / TI Indonesia |
| Mekanismenya | Hak amil diklaim **20%**, plafon **12,5%** | idem |
| Yang menemukan | **Kepala Kepatuhan & Audit Internal lembaga itu sendiri** — lalu dikriminalisasi (UU ITE Pasal 32) | idem |
| Jeda laporan → penyelidikan formal | **hampir 2 tahun** (Sprindik 30 Jan 2026) | idem |
| Cakupan audit syariah nasional | **9,25%** lembaga per tahun → satu siklus penuh butuh ~11,5 tahun | Kemenag, data 2023 |
| Realisasi terhadap potensi zakat | **13,7%** (Rp44,7 T dari Rp327 T) | LPZN 2025 / BAZNAS |
| Jumlah muzaki | **turun**, sementara nilai naik | LPZN 2025, Ringkasan Eksekutif |

**Diagnosis.** Kepercayaan di sektor ini adalah **milik bersama**. Setiap lembaga meminjam dari reputasi sektor, dan tidak punya cara membuktikan kebersihannya sendiri secara independen. Ketika satu lembaga tersandung, semua ikut membayar — terlihat dari jumlah muzaki yang turun meski nilai pengumpulan naik.

Perhatikan detail paling penting dari kasus Jabar: pelanggarannya **terlihat di pembukuan**. 20% versus 12,5% bukan hasil penyembunyian canggih. Yang tidak ada adalah mekanisme yang **menolak transaksi itu sejak awal**.

**Solusi kita.** *Trust that is earned per-institution, not borrowed from the sector.* Plafon hak amil ditegakkan oleh kode (`MAX_AMIL_BPS = 1250`), bukan diperiksa belakangan. Persetujuan DPS dan atestasi auditor tercatat permanen. Sebuah lembaga bisa membuktikan kebersihannya sendiri, terlepas dari apa yang terjadi pada tetangganya.

---

## 3. Positioning

> **ZKT adalah lapisan bukti (*evidence layer*) yang duduk di atas SiMBA dan sistem yang sudah dipakai lembaga — bukan penggantinya.**

| ✅ Yang kita katakan | ❌ Yang tidak pernah kita katakan |
| :--- | :--- |
| "Lapisan bukti yang menyuplai SiMBA" | "Pengganti SiMBA" |
| "Alat bantu kepatuhan PerBAZNAS 1/2023" | "Sistem pelaporan zakat nasional" |
| "Bukti berkelanjutan di antara siklus audit" | "Mengganti audit KAP / audit syariah Itjen" |
| "Membuktikan lembaga Anda bersih" | "Mencegah amil Anda curang" |
| "Rel teknologi untuk amil berizin" | "Kami akan jadi lembaga amil" |

**Kenapa framing ini bukan sekadar sopan santun:** akses *host-to-host* ke SiMBA tidak berdokumentasi publik — ia dijaga oleh hubungan, bukan kontrak. Framing "pengganti" menutup pintu itu secara permanen.

---

## 4. Model Bisnis

**Prinsip:** lembaga membayar langganan dari anggaran operasionalnya — yang memang bersumber dari hak amil dan wajib tercatat di RKAT (PP 14/2014 Pasal 67). Kita ditagihkan seperti listrik, sewa kantor, dan jasa KAP. **Bukan** potongan dari dana zakat.

| Segmen | Harga | % dari hak amil segmen itu | Yang membayar |
| :--- | ---: | ---: | :--- |
| UPZ | Rp9 juta/tahun | — | **Institusi induk** (kampus/BUMN/perusahaan) |
| BAZNAS Kabupaten/Kota | Rp24 juta/tahun | 4,47% | Anggaran operasional |
| BAZNAS Provinsi | Rp60 juta/tahun | **1,76%** | Anggaran operasional |
| LAZ Nasional | Rp90 juta/tahun | **0,50%** | Anggaran operasional |

*Anchor pasar: ZAINS ±Rp30 jt/tahun, SoftwareZakat.com Rp6–24 jt/tahun.*

**Kenapa bukan persentase hak amil?** Model 2,5% runtuh di lembaga besar — untuk LAZ Nasional itu Rp447 juta/tahun untuk pekerjaan yang sama. Langganan bertingkat dengan batas atas jauh lebih mudah dipertahankan di depan auditor maupun DPS.

**Lima aliran pendapatan, semuanya legal hari ini:**

1. Langganan per lembaga/UPZ
2. Biaya implementasi sekali bayar — **ini yang mendanai pendampingan intensif**, pembeda kita terhadap sistem gratis
3. Biaya layanan teknologi lewat mitra LAZ (mulai bulan 12)
4. Pekerjaan vendor untuk BAZNAS pusat — paket *managed services* SiMBA 2024 ditender **Rp3,4 miliar/tahun**
5. Hibah/CSR untuk sisi *public good* (bank syariah, CSR korporat)

---

## 5. Go-to-Market

### 5.1 Wawasan inti: jual per **klaster provinsi**, bukan per lembaga

BAZNAS Provinsi wajib menyusun *laporan zakat wilayah* — rekapitulasi seluruh kabupaten/kota di wilayahnya (PerBAZNAS 1/2023 Pasal 6 ayat (7)) — padahal data itu **tidak melewati tangan mereka**, karena kab/kota melapor langsung ke pusat lewat SiMBA.

Artinya BAZNAS Provinsi punya rasa sakit yang akut **dan** punya hubungan hangat ke seluruh kabupaten di bawahnya.

> **Satu provinsi = 1 + N akun.** Riau punya **12 BAZNAS kab/kota**. Memenangkan BAZNAS Riau berpotensi membuka 13 akun dari satu hubungan — jauh lebih murah daripada menjual dingin ke 508 kabupaten satu per satu.

Riau juga mencatat **kepatuhan pelaporan 100%** (LPZN 2025) — mereka pelapor yang baik, sehingga kredibel sebagai referensi.

### 5.2 Empat aset GTM yang sudah kita punya

| Aset | Nilai | Cara memakainya |
| :--- | :--- | :--- |
| **Juara 2 Rakornas & BAZNAS Awards 2025** | Kredensial nasional di depan ±1.200 pengambil keputusan | Kutip di setiap email dingin ke 542 BAZNAS daerah |
| **Kontak BAZNAS Riau** | BAZNAS Provinsi — segmen bernilai tertinggi | Mitra desain (gratis) → studi kasus → referensi |
| **Kontak UPZ IPB** | Pintu ke segmen UPZ yang belum tergarap | Pelanggan berbayar pertama, ditagih ke anggaran IPB |
| **Riset 0002** | Tidak ada pihak lain yang mendokumentasikan selisih Rp668 M | **Bagikan privat sebagai bantuan, jangan publikasikan sebagai serangan** |

⚠️ Aset keempat berisiko. Riset itu membuka kelemahan data BAZNAS. Dibawakan sebagai *"kami menemukan ini dan ingin membantu memperbaikinya"* ia membuka pintu; dipublikasikan sebagai temuan sensasional, ia menutup pintu selamanya.

### 5.3 Empat tahap

**Tahap 0 — Bukti (bulan 0–3): *dapatkan hak untuk berjualan***
- BAZNAS Riau jadi mitra desain (gratis, tanpa kontrak)
- Dapatkan satu angka yang belum kita punya: **berapa jam menyusun laporan zakat wilayah dari 12 kabupaten**
- UPZ IPB jadi pelanggan berbayar pertama
- *Target: 1 mitra desain · 1 pelanggan berbayar · 1 metrik rasa sakit terkuantifikasi*

**Tahap 1 — Referensi (bulan 4–9): *satu provinsi, terbukti***
- Bangun Reconciliation Engine untuk kasus nyata Riau
- Terbitkan studi kasus berangka riil
- Riau memperkenalkan kita ke kabupaten-kabupaten di wilayahnya
- *Target: 1 provinsi · 3–5 kab/kota di Riau · 5–10 UPZ*

**Tahap 2 — Klaster (bulan 10–18): *provinsi demi provinsi***
- **Rakornas 2026 (±Agustus) adalah acara berdaya ungkit tertinggi tahun itu** — datang dengan studi kasus, bukan dengan prototipe
- Masuk ke LAZ Nasional: mereka punya sistem sendiri, jadi cerita *host-to-host* paling relevan
- Buka kanal mitra LAZ / ZakatHub
- *Target: 4 provinsi · 30 UPZ · 2 LAZ Nasional*

**Tahap 3 — Platform (bulan 19–30): *jadi lapisannya***
- Kejar integrasi host-to-host resmi dengan Divisi TI BAZNAS pusat
- Ikut atau bermitra pada pekerjaan vendor BAZNAS pusat
- *Target: 10 provinsi · 100 UPZ · 8 LAZ Nasional · ARR Rp2,7 miliar*

### 5.4 Yang **tidak** kita lakukan

- ❌ Menjual dingin ke 508 BAZNAS kabupaten — anggaran terkecil, siklus terpanjang
- ❌ Menyasar masjid — segmen sudah dikanibal produk gratis (TAQMIR, eMasjid.id, DeMasjid)
- ❌ Bersaing fitur langsung dengan ZAINS di core system
- ❌ Menyebut rencana jadi LAZ selama 24 bulan
- ❌ Menyentuh *custody* dana zakat sebelum ada izin

---

## 6. Roadmap Produk

Setiap rilis terikat pada kebutuhan GTM di tahap yang sama — tidak ada fitur yang dibangun tanpa pelanggan yang menunggunya.

| Periode | Rilis | Untuk siapa | Kenapa ini, bukan yang lain |
| :--- | :--- | :--- | :--- |
| **Bulan 1–3** | **Reconciliation Engine v0** — bandingkan rekap provinsi vs data 12 kabupaten, tampilkan selisih beserta transaksi penyebabnya | BAZNAS Riau | Satu-satunya fitur yang **tidak** dikerjakan SiMBA maupun vendor eksisting |
| **Bulan 4–6** | **Modul UPZ** + ekspor berkas siap-unggah ke SiMBA | UPZ IPB | Segmen belum tergarap; institusi induk yang membayar, jadi lepas dari politik hak amil |
| **Bulan 7–9** | **Checklist Pra-Audit DPS** — menurunkan KMA 606/2020 jadi checklist per proposal penyaluran | DPS lembaga mitra | Audit syariah cuma menjangkau 9,25% lembaga/tahun; memanfaatkan `SHARIA_SUPERVISOR_ROLE` + Safe yang sudah jalan |
| **Bulan 10–12** | **AI Draft + Validator Deterministik** — AI menyusun draf, aturan menolak yang melanggar invariant, manusia menandatangani | Semua segmen | Pembedanya bukan "pakai AI" (SiMBA pun sudah), melainkan validator yang tidak bisa di-*override* |
| **Bulan 13–18** | **Integrasi host-to-host** + kanal mitra LAZ | BAZNAS pusat, LAZ Nasional | Menghapus kerja ganda — nilai jual terbesar, tapi butuh restu yang belum ada |
| **Bulan 19–30** | **Continuous Attestation** diproduksikan | LAZ Nasional, BAZNAS Provinsi | Menutup jeda 7,5 bulan laporan teraudit dengan bukti berjalan |

**Catatan tentang blockchain.** Lapisan on-chain tetap ada dan tetap menjadi tulang punggung pembuktian — tetapi **disembunyikan dari antarmuka**. Kita memimpin dengan "jam yang terhemat" dan "bukti saat diaudit"; ledger baru disebut ketika pembeli bertanya *bagaimana* sebuah angka bisa dibuktikan. Amil tidak membeli *immutability*.

---

## 7. Metrik & Kriteria Berhenti

Yang perlu Ketua pantau — dan kapan kita mengakui sebuah tesis salah.

| Gerbang | Kapan | Lolos bila | Bila gagal |
| :--- | :--- | :--- | :--- |
| **G1 — Akses realitas** | Minggu 2 | BAZNAS Riau bersedia *screen-share* SiMBA 30 menit | Cari BAZNAS Provinsi lain; tanpa ini kita buta |
| **G2 — Rasa sakit terkuantifikasi** | Bulan 1 | Ada angka jam kerja penyusunan laporan | Rasa sakitnya mungkin tidak sebesar dugaan — tinjau ulang seluruh tesis |
| **G3 — Kemauan bayar UPZ** | Bulan 1 | IPB bersedia menganggarkan | **Segmen UPZ gugur**, fokus penuh ke BAZNAS Provinsi |
| **G4 — Pelanggan berbayar pertama** | Bulan 6 | ≥1 lembaga membayar | Tesis kemauan bayar salah; pertimbangkan jalur hibah/CSR |
| **G5 — Efek klaster** | Bulan 9 | ≥2 kabupaten masuk lewat rujukan Riau | GTM klaster tidak bekerja; CAC akan jauh lebih mahal |
| **G6 — Host-to-host** | Bulan 18 | Akses API diperoleh | Batasi ambisi ke model ekspor; kerja ganda tidak hilang |

---

## 8. Risiko Utama

| Risiko | Dampak | Mitigasi |
| :--- | :--- | :--- |
| BAZNAS pusat menutup akses host-to-host | Nilai jual "hapus kerja ganda" runtuh | Rancang produk agar bernilai penuh **tanpa** integrasi; perlakukan host-to-host sebagai bonus |
| BAZNAS memperluas SiMBA ke ranah kita | Fitur terduplikasi | Bergerak di lapisan pembuktian, bukan pencatatan; jadi mitra, bukan lawan |
| ZAINS/incumbent menurunkan harga | Tekanan margin | Kita tidak bersaing di core system; jangan masuk perang harga |
| Pasar terlalu kecil (748 lembaga) | Plafon pendapatan | Terima. Ini bisnis tim kecil yang sehat, bukan bisnis skala ventura — komunikasikan sejak awal |
| Kasus korupsi baru di sektor zakat | Muzaki makin menjauh | Justru memperkuat Problem 2 — siapkan narasi yang membantu, bukan menghakimi |
| Riset kita dianggap serangan ke BAZNAS | Pintu tertutup permanen | Bagikan privat lebih dulu, dengan framing membantu |

---

## 9. Aksi 90 Hari

| # | Aksi | Tenggat | Pemilik |
| :--- | :--- | :--- | :--- |
| 1 | *Screen-share* SiMBA 30 menit dengan BAZNAS Riau. Dua pertanyaan wajib: **berapa jam menyusun laporan zakat wilayah**, dan **berapa kali data yang sama diketik ulang** | Minggu 2 | **_______** |
| 2 | Baca **PMA 19/2024** dan **PerBAZNAS 2/2016** sampai habis | Minggu 3 | **_______** |
| 3 | Tanya IPB: bersediakah menganggarkan software UPZ dari dana institusi? | Minggu 4 | **_______** |
| 4 | Cari sertifikat Rakornas 2025, catat **nama kategori lombanya persis** | Minggu 4 | **_______** |
| 5 | Bangun Reconciliation Engine v0 untuk kasus 12 kabupaten Riau | Bulan 2 | **_______** |
| 6 | Minta opini syariah tertulis atas model biaya, dari DPS lembaga mitra | Bulan 3 | **_______** |

> **Aksi #2 adalah yang paling murah dan paling penting.** Seluruh perdebatan "jadi amil atau tidak" — yang menghabiskan berjam-jam dan nyaris mengunci badan hukum kita ke bentuk nirlaba — terjadi karena belum ada yang membaca syarat izinnya. Dua dokumen, satu sore. Tanpa nama di kolom itu, keputusan ini akan dibongkar ulang di rapat berikutnya.

---

## 10. Batasan Hukum yang Tidak Bisa Ditawar

Ini garis merah, bukan preferensi. Ketiganya berkonsekuensi pidana.

1. **Tidak ada dana zakat di rekening yang kita kendalikan** sampai (dan kecuali) ada izin amil. Urutannya: izin dulu, dana belakangan — tidak pernah sebaliknya. *(UU 23/2011 Pasal 38 & 41: kurungan maks. 1 tahun / denda Rp50 juta)*
2. **Tidak menyentuh, menjaminkan, atau mengalihkan dana zakat** dalam bentuk apa pun. *(Pasal 37 & 40: penjara maks. 5 tahun / denda Rp500 juta)*
3. **Tidak memposisikan diri sebagai amil** — kita adalah rel teknologi untuk amil berizin.

Ditambah dua batasan operasional: biaya selalu **ditagihkan**, tidak pernah dipotong dari aliran zakat; dan **tidak ada pernyataan niat menjadi LAZ** selama 24 bulan ke depan.

---

## 11. Referensi

- **Keputusan:** [ADR-0016 — Commercial Positioning: Technology Vendor, Not Licensed Amil](../adr/0016-commercial-positioning-technology-vendor-not-licensed-amil.md)
- **Bukti:** [Riset 0002 — Ekosistem Pelaporan BAZNAS](../research/0002-baznas-pelaporan-audit-dan-ai.md) · §5 kualitas data · §7 friksi pusat–daerah · §10 kandidat fitur · §11 batasan regulatif · Lampiran A: cara memverifikasi ulang setiap angka
- **Arsitektur terkait:** ADR-0006 (pemisahan kewenangan DPS & Auditor) · ADR-0009 & ADR-0015 (atestasi gasless EIP-712)
- **Regulasi kunci:** UU 23/2011 · PP 14/2014 · PerBAZNAS 1/2023 · PerBAZNAS 2/2016 · PMA 19/2024 · KMA 606/2020 · PSAK 409

---

*Seluruh angka dalam dokumen ini dapat diverifikasi ulang. Lampiran A pada Riset 0002 berisi perintah unduh dan `grep` untuk setiap klaim numerik terhadap PDF resmi BAZNAS.*
