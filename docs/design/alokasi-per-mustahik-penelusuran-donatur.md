# Alokasi per mustahik pada penelusuran donatur

- Status: **terimplementasi 2026-09-23**, dikunci sebagai [ADR-0037](../adr/0037-per-beneficiary-allocation-shares-in-donor-tracing.md). Dokumen ini disimpan sebagai catatan riset dan alasan di balik rancangannya; ADR yang mengikat, kode yang berlaku.
- Tujuan: muzakki yang membuka kontribusinya lewat OTP melihat dananya terbagi ke mustahik tertentu (mis. Rp1jt → satu mustahik penuh 800k/800k, satu lagi paruh 200k/800k), tanpa membuka identitas mustahik.
- Dasar: ADR-0006 (privasi identitas penerima), ADR-0032/0033 (pooled funding, alokasi eksplisit), #103 (alokasi kontribusi), #104 (akses donatur via OTP), #107/#114 (realokasi & koreksi).

## 1. Keadaan sekarang

Alokasi **berhenti di level kegiatan**. Tidak ada dimensi mustahik di mana pun pada jalur pendanaan.

| Hal | Lokasi | Isi |
| --- | --- | --- |
| Tabel alokasi | `backend/src/db/schema.ts:699` | `contribution_allocations` = `{contribution_id, activity_id, amount_exact, fund_type, purpose, status}`. Tanpa `beneficiary_id`/`aid_line_id`. |
| Target kegiatan | `backend/src/activity.ts:241` (`activityTarget`) | Menjumlahkan **semua** aid line jadi satu `targetAmount`. Kebutuhan per mustahik hilang saat kegiatan dibuat. |
| Bacaan donatur | `backend/src/donor-access-store.ts:610` (`getDonorAllocations`) | Nama kegiatan + nominal donatur + total pooled. Komentarnya eksplisit: *"carry no other donor's identity or individual amount"*. |
| Tipe payload | `backend/src/donor-access.ts:76` (`DonorActivityAllocation`) | Berisi `activity.pooled.{totalAllocatedAmount, allocationCount}`, tanpa rincian penerima. |
| Route | `backend/src/routes/donor-access.ts:169` | `GET /api/donor/contributions/:id/allocations` |
| Tampilan | `frontend/src/features/donor/DonorContributionView.tsx` | Render daftar alokasi kegiatan. |

Ini desain sengaja, bukan kelalaian — header `backend/src/activity.ts` menyebut ADR-0032: *"Penelusuran menghubungkan kontribusi ke kegiatan yang didanai bersama (pooled funding)"*.

### Data "ke siapa" sudah ada, tinggal satu tautan

Dua ujungnya sudah lengkap; yang belum ada hanyalah **tautan antara rupiah satu donatur dengan aid line tertentu**.

- Kebutuhan per mustahik: `aid_lines_json` pada pengajuan disahkan → tiap `AidLine` punya `beneficiaryId` + `value.amountApprovedIdr` (atau valuasi barang). Ini angka 800k pada skenario.
- Realisasi per mustahik: `backend/src/db/schema.ts:757` (`disbursement_realizations`) sudah menyimpan `aid_line_id`, `beneficiary_id`, `amount_idr`, `method`, `evidence_status` — siapa benar-benar menerima berapa.

## 2. Keputusan privasi (penting — jangan dibalik tanpa ADR baru)

Permintaan awal berbunyi "muzakki tahu dananya ke **siapa**". Secara harfiah itu **melanggar ADR-0006** yang sudah terkunci 2026-06-12:

> fund flow + eligibility → transparan; donor + recipient identity → private.

Alasannya bukan formalitas: penerima zakat menurut definisi berada di bawah nisab, jadi menyebut namanya kepada pihak luar = menyiarkan kemiskinannya = pelanggaran `hifz al-nafs`. Preseden kodenya sudah ada — commit d61f63a mengganti wallet penerima pada disbursement receipt menjadi `hash(recipient||salt)` dengan disclosure selektif ke auditor, dan `asnaf` yang menjadi pembeda publik.

**Resolusi yang dikunci pengguna:** niat di balik permintaan ("dana saya tidak ditelan kolam, dia sampai ke orang nyata yang spesifik") dipenuhi lewat **pseudonim per penerima**, bukan identitas.

Yang **boleh** tampil ke donatur:

```
Mustahik #07 · Fakir · Pamulang — Rp800.000 dari Rp800.000 (penuh)
Mustahik #23 · Miskin · Pamulang — Rp200.000 dari Rp800.000 (sebagian)
```

Yang **tidak boleh** keluar ke donatur, dalam bentuk apa pun: nama, NIK, alamat/RT/RW, kontak, foto, dokumen, nama perwakilan/wali, nama penerima pembayaran.

Dua turunan yang menyertainya:

- **Label wilayah diambil dari kegiatan, bukan dari mustahik.** `beneficiary.addressOrScope` berisi "Dusun 6, Desa Sukajaya, RT 05/RW 02" — cukup presisi untuk menebak orangnya di desa kecil. Pakai satu label wilayah milik kegiatan untuk semua penerima di dalamnya.
- **Guard k-anonimitas.** Bila satu kegiatan hanya punya 1–2 mustahik, pseudonim + asnaf + nominal praktis membongkar identitas bagi siapa pun yang tahu programnya. Di bawah ambang (`MIN_ANONYMITY_SET = 3`), tampilan **turun otomatis** ke pooled-only seperti sekarang, dengan keterangan jujur bahwa rincian ditahan demi privasi penerima — bukan dikosongkan tanpa penjelasan.

## 3. Algoritma pengisian

Greedy sequential fill (water-filling) dengan kursor, urut prioritas asnaf.

```
fillAllocation(amount, targets):
  eligible = targets.filter(fundTypeEligible)        # lihat §3.2
             .filter(t => t.approvedExact != null)   # lihat §3.3
             .sort(by ASNAF_PRIORITY, then aidLineId)   # stabil & deterministik
  sisa = amount
  for t in eligible:                # kursor: baris pertama yang belum penuh
     if sisa == 0: break
     ruang = t.approvedExact - t.allocatedExact
     if ruang <= 0: continue
     bagian = min(sisa, ruang)
     emit share(t, bagian, penuh = (bagian == ruang))
     sisa -= bagian
  return { shares, unassignedExact: sisa }
```

**Kompleksitas.** Per satu alokasi: `O(k)` dengan `k` = jumlah mustahik yang benar-benar tersentuh (sort `O(n log n)` hanya bila urutan belum di-cache — lihat catatan di bawah). Sepanjang umur kegiatan total kerjanya `O(N)`, karena tiap aid line diselesaikan tepat sekali dan tidak pernah dikunjungi lagi setelah penuh. Jadi dugaan "O(n)" pada diskusi awal benar.

Catatan performa: urutan prioritas bersifat tetap selama versi pengajuan tidak berubah, jadi simpan `fill_order` sekali per versi pengajuan dan cukup lanjutkan dari kursor (baris pertama yang `allocated < approved`). Bila prioritas bisa berubah di tengah jalan, ganti ke heap → `O(log N)` per penyisipan.

### 3.1 Urutan prioritas asnaf

Ikut urutan Q9:60, yang kebetulan **sudah** menjadi urutan `VALID_ASNAF` di `backend/src/beneficiary-tabular-schema.ts:125`:

```
FAKIR → MISKIN → AMIL → MUALAF → RIQAB → GHARIM → FISABILILLAH → IBNU_SABIL
```

> **Perlu diputuskan sebelum koding:** `AMIL` berada di urutan ketiga, jadi fill greedy akan mengisi bagian amil sebelum mualaf dan seterusnya. Secara fikih itu sesuai urutan ayat, tetapi bagi donatur yang menelusuri zakatnya, melihat "dana saya masuk ke bagian amil lebih dulu" berpotensi terbaca buruk, dan banyak lembaga memang membatasi hak amil secara terpisah (mis. maksimum 12,5%). Opsi: keluarkan baris ber-asnaf `AMIL` dari fill yang terlihat donatur dan tangani lewat jalur hak amil sendiri. Belum diputuskan.

### 3.2 Jenis dana tidak boleh menyeberang

Guard level kegiatan **sudah ada** (`allocationTerms` di `backend/src/activity.ts`, memisahkan jenis dana + peruntukan antara kontribusi dan kegiatan). Di level aid line, tambahkan guard yang sama sebagai invarian defensif: kontribusi `ZAKAT` hanya boleh mengisi baris yang asnaf-nya sah menerima zakat.

Hari ini guard itu hampir selalu terpenuhi karena skema roster mewajibkan `asnaf` salah satu dari 8. Guard ini baru benar-benar menggigit untuk program `INFAK_SEDEKAH`/`KURBAN`/`DSKL` yang rosternya boleh memuat penerima non-asnaf. Tetap tulis eksplisit supaya tidak menjadi lubang saat roster itu muncul.

### 3.3 Baris bernilai tidak diketahui tidak boleh dianggap nol

`activityTarget` (`backend/src/activity.ts:245-251`) menandai `targetIsPartial = true` ketika nilai sebuah baris `null` — baris barang tanpa valuasi. Baris seperti itu **dikeluarkan dari fill** dan dilaporkan apa adanya sebagai "belum dapat dirinci", bukan diisi sebagai 0. Ini mandat ADR-0033: *"selisih ... terlihat, tidak disembunyikan sebagai nol."*

### 3.4 Uang itu fungible

Pembagian ini **atribusi akuntansi, bukan earmark fisik** — rupiah di rekening lembaga tidak bertanda. UI wajib menyatakannya. Codebase sudah punya `FUNDING_RECORD_DISCLAIMER` di `backend/src/activity.ts` persis untuk kejujuran semacam ini; pakai ulang, jangan bikin kalimat baru yang lebih longgar.

## 4. Model data

Tabel baru `allocation_beneficiary_shares`. Hasil fill **disimpan eksplisit**, tidak dihitung ulang saat dibaca — supaya koreksi dan realokasi bisa di-unwind deterministik dan riwayatnya dapat diaudit.

| Kolom | Catatan |
| --- | --- |
| `id` | PK |
| `institution_id` | FK, isolasi tenant seperti tabel lain |
| `allocation_id` | FK → `contribution_allocations.id` |
| `contribution_id` | denormalisasi, dipakai query donatur |
| `activity_id` | denormalisasi |
| `proposal_id`, `proposal_version` | versi pengajuan saat fill dijalankan |
| `aid_line_id`, `beneficiary_id` | tautan ke kebutuhan dan penerimanya |
| `beneficiary_pseudonym` | mis. `Mustahik #07`; diturunkan dari posisi penerima pada roster pengajuan (bukan dari urutan fill, supaya tidak membocorkan peringkat prioritas), lalu **disimpan** agar tidak bergeser saat pengajuan direvisi |
| `asnaf` | disalin saat fill |
| `share_exact` | rupiah dari kontribusi ini ke mustahik ini |
| `aid_line_approved_exact` | penyebut (800000) pada saat fill |
| `fill_sequence` | urutan deterministik, memudahkan replay dan audit |
| `status` | `ACTIVE` \| `REVERSED` (untuk unwind koreksi/realokasi) |
| `created_at`, `updated_at` | |

Label wilayah tidak disimpan di sini; diambil dari kegiatan saat dibaca (§2).

## 5. Urutan kerja

1. **`backend/src/allocation-fill.ts`** — modul murni (tanpa db/jaringan/jam, ikut gaya header `activity.ts`), plus unit test. Aritmetika BigInt di atas string eksak, konsisten dengan `addDecimalStrings`/`subtractDecimalStrings` di `disbursement.ts`. Repo ini test-heavy; kerjakan test-first.
   ```ts
   type FillTarget = { aidLineId; beneficiaryId; asnaf; approvedExact: string | null; allocatedExact: string };
   type FillShare  = { aidLineId; beneficiaryId; shareExact; remainingAfter; isFull };
   fillAllocation(amountExact: string, targets: FillTarget[]): { shares: FillShare[]; unassignedExact: string };
   ```
2. **Migration + schema** untuk `allocation_beneficiary_shares` (indeks pada `contribution_id` dan `aid_line_id`).
3. **Sambungkan ke `allocateContribution`** (`backend/src/activity-store.ts`): di dalam transaksi yang sudah ada, ambil target + `SUM(share_exact)` per aid line dengan `FOR UPDATE`, jalankan fill, sisipkan baris share. Replay idempoten tetap lewat `activity_operations` yang sudah ada.
4. **Unwind** pada jalur koreksi kontribusi dan realokasi (#107/#114): tandai share `REVERSED`, jangan hapus.
5. **Read path donatur**: perluas `getDonorAllocations` + `DonorActivityAllocation` dengan `shares[]`, terapkan guard k-anonimitas di sini (satu tempat, bukan di UI), dan pastikan tidak ada kolom identitas yang ikut ter-select.
6. **Tampilan** di `DonorContributionView.tsx` + disclaimer fungibilitas.

## 6. Jebakan yang sudah teridentifikasi

- **Balapan alokasi.** Kode sekarang mengunci baris kontribusi saat memeriksa batas. Fill per baris butuh kunci di aid line juga, kalau tidak dua amil paralel bisa mengisi mustahik yang sama dua kali.
- **Pembulatan.** Semua nominal adalah string bilangan bulat rupiah; jangan pernah masuk ke floating point. Fill greedy tidak menghasilkan pecahan selama semua input bilangan bulat.
- **Sisa tak teralokasi.** `unassignedExact > 0` berarti dana donatur melebihi total kebutuhan yang tersisa di kegiatan itu. Itu keadaan sah dan harus terlihat (sejalan ADR-0033 "sisa belum dialokasikan terlihat"), bukan error.
- **Revisi pengajuan.** Bila roster berubah setelah fill, `proposal_version` pada baris share membuat selisihnya terlihat; jangan diam-diam memetakan ulang ke aid line versi baru.
- **Kebocoran lewat sisi lain.** Setelah fitur ini ada, periksa ulang bahwa jalur publik (`/verifikasi`, laporan periode, paket bukti) tidak ikut menampilkan share — ini khusus untuk sesi donatur yang sudah lolos OTP.

## 7. Yang sempat terbuka, kini diputuskan (2026-09-23)

1. Baris ber-asnaf `AMIL` **dikeluarkan** dari fill yang terlihat donatur (§3.1); hak amil tetap lewat jalurnya sendiri, dan bagian yang tak terserap muncul sebagai sisa belum dirinci.
2. `MIN_ANONYMITY_SET = 3` **tetap konstanta** di modul murni. Menjadikannya kebijakan per lembaga tetap terbuka dan tidak mengubah pembaca.
3. ADR ditulis: [ADR-0037](../adr/0037-per-beneficiary-allocation-shares-in-donor-tracing.md).

## 8. Di mana kodenya

| Bagian | Berkas |
| --- | --- |
| Modul murni + guard k-anonimitas | `backend/src/allocation-fill.ts`, uji `backend/test/allocation_fill.test.ts` |
| Nilai satu baris, dipakai bersama target kegiatan | `aidLineValueIdr` di `backend/src/activity.ts` |
| Tabel + DDL | `allocation_beneficiary_shares` di `backend/src/db/schema.ts` dan `ACTIVITY_SCHEMA_STATEMENTS` |
| Tulis & unwind | `recordBeneficiaryShares`/`reverseBeneficiaryShares` di `backend/src/activity-store.ts` |
| Baca donatur | `getDonorAllocations` di `backend/src/donor-access-store.ts`, tipe di `backend/src/donor-access.ts` |
| Tampilan | `frontend/src/features/donor/DonorAllocationList.tsx` |
