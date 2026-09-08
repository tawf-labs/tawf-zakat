# Koreksi laporan — ticket #75

Irisan ini menambahkan koreksi terhadap versi yang sudah terbit. Koreksi menghasilkan versi penerus yang menunjuk pendahulunya; versi lama tetap terbit di bawah identitasnya sendiri dan tidak ditimpa. Dasarnya ADR-0020–0022 dan spec #68. Atestasi auditor tetap `NOT_EXAMINED`, sekarang selalu dibaca per identitas versi.

## Protokol suksesi

`publishReport` menerima koreksi ketika `predecessor` tidak kosong dan sama dengan `latestPublishedPackage(institution, report)` — paket yang saat itu diperlakukan registry sebagai versi resmi. Versi pertama tetap mensyaratkan `predecessor` kosong dan belum adanya versi resmi. Identitas versi dan identitas paket masing-masing hanya ditulis sekali: `publishedVersion` yang sudah terisi maupun paket yang sudah punya versi ditolak, sehingga retry tidak menggandakan versi dan penomoran pada layar tidak pernah menjadi sumber kewenangan.

Pendahulu, versi, paket, digest, kebijakan, outcome dan deadline berada di dalam payload EIP-712 yang ditandatangani lembaga dan validator. Signature versi lama karena itu tidak dapat dipakai untuk koreksinya, dan pengesahan `RECORD_EVIDENCE` tetap tidak dapat menerbitkan apa pun. Nonce sekali pakai, epoch mandat dan deadline berlaku sama seperti #73.

Dua koreksi bersaing menghasilkan paling banyak satu penerus: yang kedua menandatangani pendahulu yang sudah bukan versi resmi, sehingga `publishReport` revert dan riwayat tidak bercabang. Pihak yang kalah harus menyiapkan paket dan dua pengesahan baru terhadap versi terkini. Paket dan temuannya tetap tersimpan dan dapat dibaca sebagai pengajuan, tetapi `publishedPackageVersion` mengembalikan string kosong untuknya — ia tidak pernah muncul sebagai versi.

Pembacaan riwayat memakai tiga view: `latestPublishedPackage`, `latestPublishedVersion` dan `publishedPackageVersion`. Riwayat ditelusuri mundur dari paket resmi terkini melalui `predecessor` pada otorisasi yang diterima, bukan melalui penomoran versi atau urutan penyimpanan lokal. Tidak ada event baru, penghapusan, atau perubahan pada pencatatan bukti #72 dan penerbitan pertama #73.

## Backend dan HTTP

- `GET /api/evidence/:preparation/reports/correction?predecessor=<paket>` menyiapkan tinjauan koreksi sebelum ada paket baru: identitas pendahulu, apakah snapshot yang dipakai sama, perubahan per sisi sumber (asal, cakupan, cut-off, rincian transaksi, status pembacaan) dan per angka (`TETAP`/`BERUBAH`/`DITAMBAHKAN`/`TIDAK_LAGI_TERSEDIA`), jumlah temuan sebelum dan sesudah, serta blocker. Sumber dan angka pendahulu dibaca dari byte paketnya sendiri, tidak dihitung ulang terhadap ledger hari ini.
- `POST /api/evidence/:preparation/reports` menolak koreksi tanpa alasan, dengan pendahulu dari laporan lain, dengan versi yang sama, atau dengan pendahulu yang belum beku. Koreksi selalu menghasilkan paket baru; snapshot dan berkas pendahulu tidak disentuh.
- `GET .../publication/version` menambahkan `predecessor`, `correctionReason`, `versionState` (`VERSI_RESMI_TERKINI`, `DIGANTIKAN_KOREKSI`, `BUKAN_VERSI_RESMI`), identitas versi resmi terkini, dan daftar atestasi milik versi ini sendiri.
- `GET .../publication/history` mengembalikan garis resmi laporan, terbaru lebih dulu: versi, pendahulu, alasan koreksi, pengesah lembaga dan validator, receipt beserta waktu blok, dan atestasi per versi. Pembacaan berhenti pada batas `OFFICIAL_LINE_LIMIT` dan pada identitas yang tidak konsisten. Alasan koreksi hanya ditampilkan bila digest paket tersimpan sama dengan digest yang diterima registry, sehingga isi lokal yang menyimpang tidak muncul sebagai alasan yang disahkan. Versi yang diterbitkan lewat panggilan kontrak langsung tetap terdaftar, tetapi tanpa anchor dan tanpa alasan: registry mengikat digest paketnya, bukan teks alasannya, dan ruang kerja ini tidak memilikinya.
- Layanan validator menolak mengesahkan paket yang tidak menyusul versi resmi terkini, dan `POST .../publication/:id/submit` memeriksa ulang suksesi sebelum relay maupun rebroadcast. Satu fungsi menentukan apa yang menghalangi penerbitan — pendahulu yang bukan versi resmi terkini, akar kedua, dan label versi yang sudah dipakai versi lain — sehingga backend menyampaikan alasan yang dapat ditindaklanjuti alih-alih revert kontrak yang tanpa keterangan. Pemulihan broadcast yang hilang tidak dianggap konflik karena paket yang sudah menjadi versi resmi dikenali sebagai dirinya sendiri.

Ringkasan publik menambahkan `version` (status versi, pendahulu, paket penggantinya, paket resmi terkini) dan `history`. Alasan koreksi adalah teks bebas yang ditulis lembaga, jadi garis publik hanya menyatakan bahwa alasan tersedia bagi pembaca berwenang — konsisten dengan #74 yang menjaga judul laporan, label dan narasi tetap terbatas. Isi ringkasan yang sudah tersimpan tidak berubah ketika koreksi terbit; status versi dihitung setiap pembacaan, sehingga halaman versi lama tetap ada dan tidak diganti.

Paket pemeriksaan menyertakan `officialLine` dan `versionState`. Verifier lokal memeriksa bahwa garis membentuk satu rantai dari versi terkini sampai versi pertama, bahwa entri untuk paket ini cocok dengan versi, pendahulu dan digest hasil perhitungan ulang, dan — dengan RPC — bahwa registry mengakui setiap identitas versi tersebut.

## Atestasi

Atestasi dibaca melalui identitas versi (`institutionId`, `reportId`, `version`, `packageId`, `digest`) dan selalu dimulai kosong untuk versi baru. Belum ada alur pembuatan atestasi; justru karena itu keadaan audit tidak boleh diwarisi dari versi yang dikoreksi. Ringkasan publik, pembacaan versi dan riwayat menyatakan hal ini secara eksplisit.

## Validasi

Seams yang sama seperti #73: HTTP `app.fetch`, ABI publik Foundry, dan smoke browser dengan adapter lokal. Foundry menguji koreksi sah, pendahulu salah, lintas laporan dan lintas lembaga, versi terpakai ulang, signature versi lama, pengesahan pencatatan, expiry, validator dicabut, satu alamat dua peran, dan invariant satu garis resmi dengan versi lama yang immutable. API menguji koreksi sah, pendahulu yang sudah digantikan, akar kedua, dua koreksi bersaing, retry yang tidak menggandakan versi, reload database, riwayat publik dan terbatas, serta verifier lokal terhadap garis yang dipalsukan.

Jalankan `forge build --root sc`, `python3 scripts/export-registry-abi.py`, lalu dari `backend`: `bun test test/registry_api.test.ts`. Smoke opsional memakai `REGISTRY_BROWSER_MODULE` dan `REGISTRY_BROWSER_EXECUTABLE`. Seluruhnya tanpa AI live atau transaksi jaringan publik.

Hasil akhir pada perubahan #75:

- Foundry lokal: **108 lulus** (dari 88), termasuk fuzz koreksi dan invariant garis resmi 256 run × 500 panggilan; dua kontrak tes fork Sepolia live dikecualikan.
- Berkas registry backend: **29 lulus**, termasuk tiga smoke browser (pencatatan, penerbitan, koreksi).
- Suite backend penuh: **483 lulus, 20 gagal**. Nama kedua puluh kegagalan identik dengan baseline sebelum perubahan ini; tidak ada kegagalan baru.
- Frontend: **133 lulus**, production build berhasil. Typecheck backend/frontend tidak menambah diagnostik pada berkas yang disentuh.

Screenshot smoke perilaku (harness tanpa stylesheet produksi): `/tmp/ticket75-browser-correction.png` dan `/tmp/ticket75-public-superseded.png`. Hasil ini merupakan validasi fixture lokal, bukan audit keamanan independen atau bukti deployment publik.
