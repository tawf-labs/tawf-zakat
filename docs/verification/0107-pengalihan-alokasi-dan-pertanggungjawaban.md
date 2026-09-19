# Issue #107 — Pengalihan Alokasi dan Pertanggungjawaban Kegiatan

Issue: https://github.com/tawf-labs/tawf-zakat/issues/107. Induk: spec #100 (US-31, US-37, US-40, US-43, US-86, US-91; AC07, AC09, AC10, AC11, AC12).

AC25 (status NFT) tidak disentuh tiket ini dan tidak diklaim di sini.

## Cakupan & Aturan Bisnis

1. **Siklus pertanggungjawaban finansial dan pemisahan barang fisik dari rupiah (AC07)**
   - Menghubungkan alokasi (#103), realisasi tunai dan barang (#94/#95), uang muka serta belanja operasional (#95), penutupan sisa pengajuan (#96), dan koreksi kontribusi (#106) ke dalam satu ringkasan pertanggungjawaban kegiatan.
   - Barang fisik dicatat murni dalam kuantitasnya (`unitSummaries`: approved, realized, remaining) dan tidak pernah dijumlahkan ke total rupiah. Jumlah dengan satuan berbeda tetap terpisah.
   - Pembelian dan serah terima tidak dihitung dua kali: valuasi barang yang sudah diserahkan berhenti menjadi kewajiban, sementara biaya aktual pembeliannya dihitung sebagai pengeluaran. Harga aktual yang berbeda dari rencana mengikuti biaya aktual, bukan valuasi rencana.

2. **Ketersediaan dana dan penguncian pengalihan (AC02, AC11)**
   - Bagian yang belum diserahkan tidak otomatis tersedia. Kewajiban terdiri atas uang yang disetujui tetapi belum direalisasi (`totalCommittedMoneyIdr`) **dan** valuasi barang yang disetujui tetapi belum diserahkan (`totalCommittedGoodsIdr`), diproporsikan menurut sisa kuantitas. Keduanya dijumlahkan pada `totalCommittedAidIdr`.
   - Status `INDETERMINATE` diberikan ketika data belum cukup untuk menetapkan ketersediaan: uang muka belum dipertanggungjawabkan, barang tanpa valuasi rupiah pada pengajuan yang belum ditutup, selisih kontribusi yang belum selesai, atau satuan kegiatan bukan rupiah sehingga kewajiban rupiah tidak dapat dibandingkan tanpa dasar konversi. Pada status ini pengalihan ditolak HTTP 400 (`AllocationAvailabilityError`).
   - Penutupan sisa pengajuan (#96) atau pembatalan menghentikan kewajiban yang tersisa. Alokasi yang belum terserap kemudian menjadi `AVAILABLE`, tetapi tidak dialihkan otomatis; pengalihan tetap memerlukan keputusan eksplisit.

3. **Pencatatan keputusan pengalihan dan jejak donatur (US-37, US-40, US-43)**
   - Keputusan dicatat pada `reallocation_decisions`: lembaga, kegiatan asal dan tujuan, alokasi asal dan tujuan, kontribusi, nominal, jenis dana, peruntukan, alasan, akun dan ID petugas, serta versi kegiatan dan alokasi kedua sisi.
   - Alokasi asal dipotong nominalnya; bila seluruhnya dialihkan, statusnya menjadi `REALLOCATED` dengan nominal 0.
   - Alokasi baru mewarisi `contribution_id` dan menyimpan `source_allocation_id`, sehingga penelusuran donatur tidak terputus.
   - `allocation_history` mencatat `REALLOCATE_OUT` pada alokasi asal dan `REALLOCATE_IN` pada alokasi tujuan.

4. **Jenis dana dan peruntukan (AC09)**
   - Pengalihan memeriksa kesesuaian jenis dana kontribusi terhadap program kegiatan tujuan lewat `SPENDABLE_BY_PROGRAM`, dan menolak peruntukan yang tidak selaras dengan batasan kontribusi. Pelanggaran menghasilkan HTTP 400.

5. **Selisih koreksi dan pengembalian dana (AC10, AC12)**
   - Selisih antara alokasi dan nilai kontribusi yang masih tercatat setelah koreksi dilaporkan pada `totalContributionShortfall`, diatribusikan ke kegiatan ini menurut porsi alokasi yang dipegangnya sehingga satu selisih tidak dihitung ganda pada dua kegiatan. Selama selisih belum selesai, ketersediaan `INDETERMINATE` dan pengalihan ditolak — mencegah sisa yang sama dihabiskan dua kali.
   - Pengembalian dana yang sudah dibayar (`PAID`) keluar dari nilai kontribusi; yang baru diputuskan (`DECIDED`) tetap terikat. Keduanya tidak dapat berpindah menjadi alokasi kegiatan lain. Membayar pengembalian tidak menciptakan keputusan pengalihan.

6. **Konkurensi, idempotensi, dan isolasi ruang kerja lembaga (AC04, AC29)**
   - Kedua kegiatan dikunci `FOR UPDATE` dalam urutan deterministik, lalu pengajuan di balik kedua kegiatan juga dikunci. `recordRealizations` sudah mengunci `proposal_drafts`; `recordAdvance` dan `recordExpense` **belum**, sehingga keduanya ditambahkan kunci yang sama pada tiket ini. Tanpa kunci bersama, pencatatan biaya dapat commit berdampingan dengan pengalihan dan keduanya membaca sisa yang sama.
   - Kunci menyelesaikan urutan biaya-lebih-dulu: pengalihan membaca sisa yang sebenarnya lalu ditolak. Urutan sebaliknya tidak dapat dicegah dengan kunci dan memang tidak seharusnya — biaya adalah catatan kejadian nyata dan tidak boleh ditolak. Yang terjadi kemudian adalah **kelebihan komitmen**, bukan pengalihan ganda: dana yang dialihkan memang bebas pada saat keputusan diambil.
   - Kelebihan komitmen dilaporkan pada `totalOverCommitmentIdr` dan menetapkan `INDETERMINATE`, sejalan dengan cara selisih kontribusi ditangani (AC10). Sebelumnya kondisi ini berstatus `NONE` dengan pesan "seluruh dana teralokasi telah terserap" — pernyataan yang tidak benar dan menyembunyikan kelebihan sebagai nol.
   - Operasi idempoten lewat `operationId` dan `activity_operations`; replay permintaan identik mengembalikan hasil sama, payload berbeda dengan `operationId` sama ditolak 409.
   - Versi kegiatan asal wajib; versi kegiatan tujuan diperiksa bila dikirim (`expectedTargetActivityVersion`) dan menolak 409 saat basi.
   - Isolasi antar ruang kerja lembaga ditegakkan: petugas lembaga lain menerima 404 saat mengakses pertanggungjawaban, riwayat, atau mengeksekusi pengalihan pada kegiatan lembaga lain.

---

## Verifikasi Pengujian

`backend/test/activity_reallocation_api.test.ts` berjalan melalui HTTP Hono sungguhan, PGlite terisolasi, berkas terenkripsi, dan otentikasi tanda tangan EIP-712 (US-91). Koreksi kontribusi dan pengembalian dana dipanggil lewat endpoint #106 yang sebenarnya, bukan penulisan langsung ke basis data.

- **AC07** — Pertanggungjawaban kegiatan memisahkan satuan fisik (`paket`) dari rupiah tanpa penghitungan ganda.
- **AC02, AC07** — Barang bervaluasi yang belum diserahkan menahan alokasi; hanya porsi yang sudah diserahkan yang dibebaskan (20 paket senilai 2.000.000: sebelum penyerahan `NONE`, setelah 15 paket diserahkan tersedia 1.500.000).
- **AC07** — Harga aktual pembelian yang berbeda dari valuasi rencana yang dihitung, bukan rencananya.
- **AC11** — Uang muka belum dipertanggungjawabkan memblokir pengalihan dengan HTTP 400.
- **AC11** — Barang tanpa valuasi pada pengajuan yang belum ditutup menetapkan `INDETERMINATE`.
- **AC11** — Penutupan sisa pengajuan (#96) menjadikan sisa alokasi `AVAILABLE` tanpa pengalihan otomatis.
- **US-37, US-40, US-43** — Pengalihan mencatat keputusan, memutakhirkan saldo kedua kegiatan, menulis riwayat timbal balik, dan mempertahankan keterlacakan donatur.
- **AC09** — Menolak jenis dana kontribusi yang tidak kompatibel dengan program kegiatan tujuan (ZAKAT ke INFAK), serta pengalihan melebihi sisa tersedia atau melebihi nominal alokasi asal.
- **AC10, #106** — Koreksi lewat endpoint `/contributions/:id/correct` menghasilkan selisih 500.000 yang terlihat, menetapkan `INDETERMINATE`, menolak pengalihan, dan membiarkan alokasi terdahulu tetap utuh.
- **AC12, #106** — Pengembalian yang diputuskan lalu dibayar tidak dapat dialihkan dan tidak menghasilkan keputusan pengalihan.
- **AC03** — Versi kegiatan tujuan yang basi ditolak 409; menghilangkan versi tujuan tetap diperbolehkan dan dijaga versi kegiatan asal.
- **AC04 konkurensi** — Penguncian baris mencegah pengalihan ganda pada permintaan paralel; pencatatan biaya bersamaan dengan pengalihan tidak pernah menghasilkan pengalihan ganda yang diam, dan kelebihan komitmen yang timbul tetap terlihat.
- **Idempotensi** — Replay `operationId` sama mengembalikan hasil identik; payload berbeda ditolak.
- **AC29** — Isolasi antar ruang kerja lembaga (lembaga lain ditolak 404).
- **Durabilitas** — `database.reopen()` membuktikan riwayat, keputusan, dan kalkulasi bertahan setelah restart.

### Smoke browser (AC06)

`frontend/test/activity-reallocation-smoke.tsx` memuat `ActivityDetailModal` dan `ReallocateModal` yang sebenarnya terhadap API hidup, dijalankan Chromium pada lebar 390px (petugas memutuskan ini dari ponsel di lapangan). Opt-in lewat `REGISTRY_BROWSER_MODULE`, digerakkan dari `activity_reallocation_api.test.ts`:

- AC05 — layar menampilkan teralokasi, sisa kebutuhan, hak bantuan belum diserahkan, selisih kontribusi, dan status ketersediaan sebagai bacaan tersendiri; penanda "Sisa Bantuan Ditutup (SK Sah)" terlihat.
- Dialog muat pada 390px tanpa gulir menyamping.
- Alasan pengalihan wajib: submit tanpa alasan ditolak di layar.
- Nominal melebihi sisa tersedia ditolak sebelum dikirim.
- Pengalihan sah menutup formulir, keputusan tercatat di basis data dengan nominal, tujuan, alasan dan ID petugas yang benar.
- Satu keputusan terbaca sama dari kedua ujung: "Keluar ke" pada kegiatan sumber, "Masuk dari" pada kegiatan tujuan.
- Petugas lain yang mengalihkan dana di layar terpisah membuat versi layar ini basi; submit berikutnya ditolak dengan pesan versi, dan hanya dua keputusan yang benar-benar tercatat.

Smoke ini menemukan satu cacat nyata yang lolos dari tes unit: klien masih mengirim `expectedSourceVersion` sedangkan route sudah membaca `expectedVersion`, sehingga setiap pengalihan dari UI gagal 400. Tes unit tidak menangkapnya karena menyusun payload sendiri.

```bash
bun test test/activity_reallocation_api.test.ts
```
**18 pass, 1 skip, 0 fail** tanpa browser; dengan `REGISTRY_BROWSER_MODULE` dan `REGISTRY_BROWSER_EXECUTABLE` disetel: **19 pass, 0 fail, 663 expect() calls** [11.8s].

Seluruh suite backend: **1022 pass, 26 skip, 0 fail, 8228 expect() calls** pada 79 berkas [133s].

Regresi terkait: `test/activity_allocation_api.test.ts` dan `test/contribution_correction_api.test.ts` — **24 pass, 2 skip, 0 fail** [9.4s].

---

## Verifikasi Antarmuka

1. **`ReallocateModal.tsx`**
   - Formulir pengalihan dengan pilihan alokasi sumber aktif dan kegiatan tujuan di ruang kerja yang sama.
   - Menampilkan sisa dana yang dapat dialihkan dan membatasi nominal terhadap sisa tersebut serta terhadap nominal alokasi sumber.
   - Alasan pengalihan wajib diisi agar keputusan dapat dipertanggungjawabkan.
   - Mengirim versi kegiatan asal dan tujuan, sehingga layar yang sudah basi ditolak server, bukan diterapkan diam-diam.

2. **`ActivityDetailModal.tsx`**
   - Kartu pertanggungjawaban: realisasi uang, biaya aktual, uang muka petugas, sisa uang muka, hak bantuan belum diserahkan (dengan porsi barangnya), dan selisih kontribusi.
   - Kelebihan komitmen, bila ada, ditandai merah dengan nominalnya dan keterangan bahwa kelebihan menunggu telaah lembaga.
   - Selisih yang bukan nol ditandai merah dengan penjelasan bahwa selisih tetap terlihat dan tidak ditulis menjadi nol.
   - Tabel rincian barang fisik terpisah dari rupiah: jenis bantuan, satuan, disetujui, terealisasi, sisa.
   - Tabel riwayat pengalihan: arah masuk/keluar, nominal, jenis dana, alasan, pejabat, waktu.
   - Status ketersediaan dibaca dari `availabilityStatus` kegiatan, bukan dari status penyaluran, dan tombol pengalihan hanya muncul saat `AVAILABLE`.

3. **Pemeriksaan tipe dan pengujian frontend**
   - `bunx tsc --noEmit`: **lulus, 0 error**.
   - `bun test`: **216 pass, 0 fail, 611 expect() calls** pada 24 berkas.
