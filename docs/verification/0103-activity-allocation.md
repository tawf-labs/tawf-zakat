# Issue #103 — smoke alokasi kontribusi

Tanggal: 2026-09-17. Issue: https://github.com/tawf-labs/tawf-zakat/issues/103

## Verifikasi lanjutan 2026-09-19 setelah #92–99

Baseline source: `cf86ea5`. Blocker keputusan durable #93 dari pemeriksaan 17 September sudah tersedia di implementasi terbaru. Helper suite #103 dan script penyiapan QA kini mengunggah dokumen keputusan, meminta challenge, menandatanganinya dengan akun pengesah terpisah dari penyusun/pemeriksa, lalu menyimpan keputusan melalui `/proposals/:id/decide`. Tidak ada UPDATE status APPROVED lewat SQL lagi. Opsi script lama `--simulate-approval` ditolak; jalankan script tanpa opsi itu.

- Suite gabungan #93/#103 pada PGlite + Chromium: **31 pass**, 710 assertions (sebelum penambahan kasus nominal disetujui lebih kecil).
- Kasus tambahan menemukan bug: usulan 1000000 yang disetujui 600000 menghasilkan target kegiatan 1000000. `activityTarget` kini memakai `amountApprovedIdr` jika tersedia, mengikuti hak bantuan yang diputuskan. Kasus ini gagal sebelum perbaikan.
- Suite #103 terakhir pada schema PostgreSQL terisolasi + Chromium: **14 pass**, 293 assertions, termasuk kasus nominal disetujui 600000 dan pembacaan keputusan durable, concurrency, retry, batas saldo, serta pembaruan panel sebelum reload. Mode restart PostgreSQL masih berupa reconnect klien, bukan restart server database.
- Data lokal baru `qa103-1789821658578`: dua pengajuan sudah APPROVED melalui keputusan bertanda tangan `SK-qa103-1789821658578-proposal-a` dan `SK-qa103-1789821658578-proposal-b`; kontribusi sintetis 900000 dan 400000 sudah direkonsiliasi/disahkan lewat API. Mandat pengesah baru dibatasi pada program QA selama satu hari. Dokumen QA baru memakai penyimpanan terenkripsi khusus `/tmp/qa103-sep19-runtime`.
- QA Chrome pengguna selesai setelah pengguna menandatangani login ulang: wallet tetap `0x5e9B…9968`, officer `off-sinar-smoke-browser`, lembaga Sinar Amanah. API lokal direstart untuk memuat perbaikan target sebelum membuat kegiatan baru.

### Hasil Chrome pengguna, run keputusan durable

| Pemeriksaan | Hasil teramati |
| --- | --- |
| Keputusan #93 | UI pengajuan A menampilkan Disetujui Lembaga, versi 1, SK-qa103-1789821658578-proposal-a, tanggal 2026-09-19, hak disetujui 1000000. Keputusan disiapkan melalui API dengan signer development sintetis; bukan ditandatangani wallet pengguna di Chrome. |
| Kegiatan A/B | Dibuat melalui Chrome dari masing-masing pengajuan V1, target 1000000. Percobaan membuat kegiatan A lagi ditolak karena versi yang sama sudah memiliki kegiatan. |
| Kontribusi A ke dua kegiatan | 300000 ke A lalu 200000 ke B; sisa kontribusi 400000. |
| Batas dana | Percobaan 600001 saat sisa 600000 ditolak dengan pesan nominal melebihi sisa kontribusi. |
| Kontribusi B anonim ke A | 150000; sisa kontribusi B 250000. Kegiatan A menjadi 450000 dari dua kontribusi, sisa kebutuhan 550000; kegiatan B 200000, sisa kebutuhan 800000. |
| Pembaruan tanpa reload | Kedua panel langsung menunjukkan angka baru setelah setiap alokasi sukses. |
| Penelusuran | Peruntukan umum/pendidikan tetap melekat pada sumbernya, donor anonim ditandai tidak tercatat, riwayat memuat alasan, officer, wallet, waktu, dan versi kontribusi 3. Batas penelusuran dan catatan internal bukan saldo bank ditampilkan. |
| Reload | Wallet, sesi, semua alokasi dan sisa tetap sama. Sisa kontribusi tidak berpindah otomatis. |

**Status QA #103: lulus pada cakupan acceptance criteria yang diuji, dengan batas restart database berikut.** Blocker keputusan durable #93 pada run lama sudah terselesaikan. Concurrency, retry, versi usang, isolasi, dan koreksi kontribusi diverifikasi melalui suite HTTP/SQL; interaksi alokasi dan pembacaan sisa diverifikasi pada Chrome pengguna. Pengujian restart dalam suite PostgreSQL adalah reconnect klien, bukan restart container/server PostgreSQL. Tidak ada transaksi onchain atau uang sungguhan yang dipindahkan.

Bagian bertanggal 17 September di bawah adalah catatan historis; batas simulasi persetujuannya tidak berlaku untuk suite terbaru.

## Hasil

- Suite #103: **13 pass, 0 fail**, 218 assertions, memakai PostgreSQL lokal pada database `zkt`, port 5432, dan Chromium headless.
- Regresi `contribution_api`, `disbursement_api`, `workspace_api`, `workspace_store`: **89 pass, 2 skip, 0 fail**. Dua tes browser milik #89/#102 tidak diaktifkan pada run regresi.
- Tes client kegiatan/kontribusi: **8 pass, 0 fail** pada run awal.
- `bun run verify:ssr` di frontend: build lulus; `/`, `/donasi`, `/verifikasi`, `/tata-kelola`, `/about` mengembalikan HTTP 200.

Smoke browser membuka ruang kerja dengan akun sintetis dan tanda tangan nyata dari key fixture lokal, membuat kegiatan dari pengajuan yang disahkan, lalu mengalokasikan Rp300.000 dari kontribusi Rp700.000. Input Rp700.001 ditolak. Daftar kontribusi menunjukkan alokasi Rp300.000 dan sisa Rp400.000. Setelah reload, sisa kontribusi dan pendanaan kegiatan tetap sama; detail kegiatan memuat alasan alokasi. Tidak ada `pageerror` pada run akhir. Screenshot lokal: `/tmp/issue103-browser.png`.

Tes HTTP/SQL mencakup satu kontribusi ke dua kegiatan, beberapa donor ke satu kegiatan, jenis dana/peruntukan, batas alokasi, concurrency, versi usang, retry, selisih akibat koreksi kontribusi, isolasi lembaga, dan pembacaan ulang sesudah reconnect.

## Temuan yang diperbaiki

Smoke awal menemukan error React yang dapat dipulihkan: `ConnectKit Hook must be inside a Provider`. Fallback `Suspense` provider merender anak-anak ketika provider belum siap, sehingga tombol ConnectKit bisa memanggil hook tanpa konteks. `SafeConnectKitButton` sekarang menunggu konteks kesiapan provider sebelum merender tombol asli. Smoke yang sama kemudian lulus dengan pemeriksaan `pageerror`, dan verifikasi SSR tetap lulus.

## Menjalankan ulang

Dari direktori `backend`, isi `ACTIVITY_TEST_DATABASE_URL` dengan URL database lokal dan `REGISTRY_BROWSER_MODULE` dengan path absolut modul Playwright atau Playwright Core yang sudah terpasang:

```bash
ACTIVITY_TEST_DATABASE_URL="$LOCAL_SMOKE_DATABASE_URL" \
REGISTRY_BROWSER_MODULE="$LOCAL_PLAYWRIGHT_MODULE" \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/activity_allocation_api.test.ts
```

Database helper membuat schema unik `smoke_<uuid>` dan membersihkannya setelah suite. Koneksi menggunakan `search_path` schema tersebut; tabel/data aplikasi yang sudah ada tidak digunakan atau dibersihkan. Tanpa URL eksplisit, helper tetap memakai PGlite terisolasi seperti sebelumnya.

## Batas verifikasi

- Pengesahan pengajuan disiapkan melalui SQL setelah alur submit/examine/ready, mengikuti fixture suite lama. Ini tidak memverifikasi alur persetujuan #93.
- Dalam mode PostgreSQL, tes bernama restart membuka ulang koneksi klien. Container/server PostgreSQL tidak direstart.
- Browser memakai komponen ruang kerja asli dalam bundle smoke dan akun sintetis. Ini memverifikasi interaksi, bukan layout/CSS produksi, wallet ekstensi nyata, atau transaksi onchain.
- Pembacaan pendanaan kegiatan diperiksa setelah reload; pembaruan otomatis lintas panel tanpa reload tidak termasuk assertion ini.

## QA interaktif di Chrome pengguna

Tanggal: 2026-09-17. Halaman aplikasi asli `http://localhost:3000/ruang-kerja`, ekstensi wallet pengguna, login ditandatangani pengguna. Sesi berhasil masuk sebagai `off-sinar-smoke-browser`, role OFFICER, lembaga `lpz-sinar-amanah`. Pemeriksaan ini terpisah dari suite fixture di atas; data aplikasi yang tersedia masih berlabel sintetis/smoke.

| Pemeriksaan | Hasil observasi |
| --- | --- |
| Login wallet nyata | Berhasil masuk dan membaca ruang kerja Sinar Amanah. |
| Melebihi saldo | Input 200001 pada `c-smoke-infak` (sisa 200000) ditolak dengan pesan nominal melebihi sisa. |
| Jenis dana berbeda | Input 100000 dari `c-smoke-infak` ke kegiatan zakat ditolak dengan pesan INFAK_SEDEKAH tidak dapat mendanai ZAKAT. |
| Kontribusi saldo nol | Pada `c-smoke-tanpa-nama`, input 1 dan alasan terisi tetap membuat tombol konfirmasi dinonaktifkan. |
| Pengajuan belum disahkan | Pembuatan kegiatan dari `prop-smoke-belum-sah` ditolak karena status DRAFT. ID/status dikonfirmasi lewat SELECT lokal; formulir dikirim dari Chrome. |
| Pendanaan gabungan | Kegiatan `act-fd030a08-5b7d-45c8-bad2-d934db91d44b` menampilkan 500000 dari dua kontribusi, target 1500000, sisa kebutuhan 1000000. |
| Penelusuran | Detail menampilkan sumber, jenis dana, peruntukan, alasan, aktor/officer, versi kontribusi, serta keterangan batas penelusuran dan catatan internal bukan saldo bank. Donor anonim ditandai “Donatur tidak tercatat” di detail kegiatan. |

Temuan aplikasi: console Chrome mencatat hydration mismatch pada `SafeConnectKitProvider` (Suspense di client berhadapan dengan main DeploymentGate dari SSR). React memulihkan render. Ini masih ditemukan pada aplikasi asli meskipun smoke bundle sebelumnya lolos; belum diperbaiki dalam run QA interaktif ini.

Observasi yang belum dapat disimpulkan sebagai bug:

- `c-smoke-donatur-a` sekarang bernilai 150000 (V4), sedangkan alokasi historisnya 200000 (V3). Daftar dan detail konsisten menampilkan sisa 0 dan selisih 50000. Riwayat audit UI hanya berisi RECORD V1, RECONCILE V2, ENDORSE V3; asal perubahan V4 tidak tersedia pada UI. Belum dibuktikan bahwa kondisi ini dibuat lewat alur aplikasi, bukan persiapan data smoke.
- Setelah reload, alamat yang ditampilkan berubah dari `0x5e9B…9968` menjadi `0x162b…5810` dan halaman kembali ke login. Pengguna mengonfirmasi tidak mengganti akun. Saat Disconnect ditekan pada modal akun kedua, akun `0x5e9B…9968` dan sesi Sinar Amanah kembali tanpa tanda tangan ulang. Reload berikutnya mempertahankan akun asli. Gejala mengarah ke pemulihan beberapa koneksi; belum diketahui provider yang memasok akun kedua. Konfigurasi memakai konektor `injected()` umum; implementasi wagmi lokal mencoba reconnect seluruh konektor berizin. Belum ada perbaikan kode atau reproduksi deterministik yang membuktikan penyebab akhirnya. Data kegiatan dan kontribusi yang dibaca sesudah pemulihan sama dengan sebelum percobaan penolakan.

Batas run interaktif: tidak ada alokasi baru yang berhasil dibuat. Kedua kontribusi zakat yang disahkan memiliki sisa nol; saldo tersedia lainnya berjenis infak dan ditolak untuk kegiatan zakat. Alokasi parsial sukses, satu kontribusi ke dua kegiatan, concurrency/retry, serta pembaruan lintas panel belum diuji ulang pada Chrome pengguna. Semua percobaan mutasi dalam run ini ditolak; tidak ada catatan pendanaan baru yang berhasil dibuat dan tidak ada transaksi onchain yang dikirim.

### Perbaikan pemulihan wallet setelah QA

Perilaku reconnect default Wagmi direproduksi dengan dua konektor berizin memakai implementasi Wagmi asli: kedua koneksi dipulihkan, dan saat konektor pilihan tidak tersedia/tidak berizin, konektor lain otomatis digunakan. Lima skenario regresi gagal dengan perilaku default tersebut.

Perubahan aplikasi:

- Matikan reconnect menyeluruh saat mount. Setelah penyimpanan selesai dihidrasi, pulihkan hanya `recentConnectorId`; tunggu pengumuman EIP-6963 jika konektor pilihan terlambat ditemukan. Jika tidak tersedia atau izin dicabut, jangan memilih wallet lain.
- Hapus konektor `injected()` generik yang bergantung pada pemilik `window.ethereum`. Wallet browser memakai identitas provider EIP-6963. Sesi lama dengan ID `injected` perlu memilih wallet kembali secara eksplisit. WalletConnect/Coinbase tetap tersedia.
- Aktifkan mode SSR Wagmi dan samakan render awal SafeConnectKitProvider dengan server; Suspense diperkenalkan setelah mount.

Verifikasi: tujuh tes reconnect lulus (termasuk discovery terlambat, koneksi manual, dan disconnect tanpa memunculkan akun cadangan); 24 tes controller/sesi ruang kerja lulus; build dan lima route pada `verify:ssr` lulus. Chrome pengguna mempertahankan akun `0x5e9B…9968` dan sesi Sinar Amanah pada dua reload setelah perbaikan. Pada reload pembanding tidak ada log error baru, termasuk hydration mismatch. Typecheck seluruh frontend masih gagal pada berkas lain; tidak ada diagnostik pada berkas perbaikan wallet. Integrasi hydration memakai API persisted store internal Wagmi yang dilokalisasi dalam `SelectedWalletReconnect`; perlu diverifikasi kembali jika versi Wagmi/Zustand berubah.

Perbaikan ini tidak mengubah status ketercakupan alokasi positif pada QA interaktif #103 di atas.

## QA lanjutan dengan saldo simulasi baru

Run `qa103-1789647310363`, 2026-09-17, Chrome pengguna dengan wallet `0x5e9B…9968`. Bagian ini melengkapi batas alokasi positif run sebelumnya.

Penyiapan memakai `backend/src/scripts/seed-qa103.ts`, khusus localhost dan lembaga sintetis. Dua akun development publik yang sudah di-onboard melakukan pencatatan → rekonsiliasi → pengesahan kontribusi lewat API nyata. Tidak ada uang atau transaksi blockchain. Semua baris baru memakai label SIMULASI; kontribusi lama tidak ditambah atau dikoreksi. Pengajuan disusun, diajukan, diperiksa, dan dinyatakan siap lewat API; hanya status persetujuannya disimulasikan lewat SQL karena jalur keputusan durable #93 belum tersedia.

Untuk membuat satu set baru (setiap pemanggilan menambah data unik):

```bash
cd backend
DATABASE_URL="$LOCAL_QA_DATABASE_URL" bun src/scripts/seed-qa103.ts --simulate-approval
```

### Hasil teramati di Chrome

| Langkah | Hasil |
| --- | --- |
| Buat kegiatan A dan B dari dua pengajuan simulasi | Berhasil, masing-masing terikat pengajuan V1, target 1000000. |
| Ulangi pembuatan A untuk pengajuan/versi yang sama | Ditolak dengan pesan kegiatan sudah dibuat. |
| Kontribusi A 900000 → kegiatan A 300000 | Berhasil; sisa kontribusi 600000. |
| Kontribusi A → kegiatan B 200000 | Berhasil; total alokasi A 500000, sisa 400000. |
| Kontribusi B anonim 400000 → kegiatan A 150000 | Berhasil; sisa B 250000; kegiatan A total 450000 dari dua kontribusi. |
| Peruntukan dan riwayat | “QA bantuan umum” dan “QA bantuan pendidikan” tetap terpisah pada sumber masing-masing; donor anonim dinyatakan tidak tercatat; alasan, wallet, officer, V3 kontribusi dan waktu tampil. Tidak ada pemetaan donor ke penerima rekaan. |
| Pembaruan tanpa reload | Gagal pada alokasi pertama: kontribusi 300000 tetapi kegiatan masih 0. Setelah perbaikan, alokasi kedua dan ketiga langsung memperbarui kedua panel. |
| Reload akhir | Wallet dan sesi tetap sama; semua angka akhir identik. Tidak ada perpindahan otomatis sisa dana. |
| Backend dinyalakan kembali | Alokasi pertama tetap 300000 saat API dan frontend dipulihkan. Ini pengamatan restart proses aplikasi, bukan restart server PostgreSQL. |

Saldo akhir yang sengaja disisakan untuk QA berikutnya:

- Kontribusi `qa103-1789647310363-contribution-a`: diterima 900000, dialokasikan 500000, sisa **400000**.
- Kontribusi `qa103-1789647310363-contribution-b`: diterima 400000, dialokasikan 150000, sisa **250000**.
- Kegiatan A `act-ecbe4e22-eb2e-4582-a03a-20e953907791`: alokasi **450000**, sisa kebutuhan **550000**.
- Kegiatan B untuk `qa103-1789647310363-proposal-b`: alokasi **200000**, sisa kebutuhan **800000**.

### Perbaikan dan cakupan acceptance criteria

Verifikasi build terakhir sesudah perbaikan panel: `bun run verify:ssr` lulus, kelima route pemeriksaan mengembalikan HTTP 200. `git diff --check` bersih.

`WorkspacePanel` kini meneruskan notifikasi alokasi sukses dari `ContributionPanel` ke `ActivityPanel` untuk memuat ulang ringkasan tanpa reload halaman. Filter dan tampilan panel dipertahankan. Assertion browser ditambahkan **sebelum** reload: suite lama gagal tepat pada angka kegiatan yang basi (12 pass, 1 fail), lalu lulus **13/13**, 218 assertions, setelah perbaikan. Tes client: **8/8** lulus. Run terisolasi juga mencakup dua petugas bersamaan, retry identik, payload retry berubah, versi usang, batas dana, isolasi lembaga, dan reconnect database; kasus concurrency/retry dijalankan lewat HTTP/SQL, bukan klik paralel di Chrome pengguna.

**Status #103: alokasi dan pembacaan saldo telah diuji; tiket belum dapat dinyatakan lulus penuh.** AC pertama mensyaratkan keputusan durable #93. Komentar issue menyebut `/proposals/:id/approve`, tetapi source saat QA hanya menyediakan `/proposals/:id/verify-approval` (memeriksa otorisasi tanpa menyimpan keputusan). Simulasi APPROVED tidak memenuhi AC tersebut. Ini blocker implementasi, bukan kekurangan saldo QA. Tidak ada klaim restart server PostgreSQL, dan alur persetujuan nyata belum lulus end-to-end.
