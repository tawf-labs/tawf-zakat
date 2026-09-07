# Pencatatan bukti registry pilot — ticket #72

Pencatatan mengikat paket beku dari #71 dengan pengesahan lembaga. `LOLOS` dan
`DITOLAK` sama-sama dapat dicatat. `EvidenceRecorded` tidak menerbitkan laporan,
mengesahkan kebenaran sumber, atau menyatakan opini auditor. Publikasi dengan dua
kewenangan, koreksi resmi, dan atestasi tetap irisan berikutnya dari #68.

## Deployment dan mandat

Registry `sc/src/ReportEvidenceRegistry.sol` tidak menerima dana, memiliki proxy,
atau memanggil vault. Tidak ada alamat atau role deployment vault yang diwarisi.
Constructor menerima `admissionAuthority` eksplisit. Pihak itu hanya dapat
mendaftarkan lembaga yang belum terdaftar melalui `enrollInstitution(string,address)`.
ID lembaga harus sama persis dengan ID ruang kerja. `InstitutionEnrolled` dan getter
administrator memungkinkan pemeriksaan mandat onboarding.

Administrator awal **tidak otomatis menjadi pengesah**. Administrator memanggil
`setSignatory(institutionId, account, active)`. Semua perubahan membawa event dan
menaikkan epoch akun, termasuk aktivasi ulang. Rotasi administrator memakai
`proposeAdministrator` kemudian `acceptAdministrator` oleh penerus. Proposal nol
membatalkan usulan. Admission tidak mempunyai jalur mengganti administrator atau
pengesah lembaga setelah enrollment. Rotasi administrator tidak mengubah daftar
pengesah: cabut mandatnya secara eksplisit bila diperlukan. Kehilangan seluruh
kewenangan lembaga tidak memiliki bypass pemulihan dalam kontrak ini.

`sc/script/DeployReportEvidenceRegistry.s.sol` membutuhkan chain ID dan admission
address eksplisit, serta signer Foundry yang dipilih operator. Script ini hanya
membuat registry; enrollment merupakan transaksi administratif terpisah. Tidak ada
script dijalankan di jaringan publik sebagai bagian implementasi #72.

Backend memerlukan kelima konfigurasi berikut; konfigurasi sebagian ditolak:

| Variabel | Isi |
| --- | --- |
| `REPORT_REGISTRY_RPC_URL` | RPC deployment registry |
| `REPORT_REGISTRY_CHAIN_ID` | Chain ID, diverifikasi terhadap RPC |
| `REPORT_REGISTRY_ADDRESS` | Alamat registry, domain EIP-712 diperiksa live |
| `REPORT_REGISTRY_RELAYER_KEY` | Kunci operator khusus relayer, bukan kewenangan pengesah |
| `REPORT_REGISTRY_CONFIRMATIONS` | Kedalaman blok positif yang disyaratkan |

Identitas kebijakan konfirmasi adalah `block-depth-v1:<chainId>:<depth>` dan dibawa
dalam setiap status. Ini menghitung kedalaman pada chain registry, bukan finalitas
settlement L1. Alamat dan mandat mitra nyata harus diisi dari onboarding; fixture
lokal bukan mandat produksi. Tanpa konfigurasi, API mengembalikan 503.

## Otorisasi dan isi yang ditinjau

Domain EIP-712: `Tawf Report Evidence`, versi `1`, chain ID, alamat registry.
`shared/report-registry.ts` mendefinisikan tipe `Authorization`. Field-nya berurutan:
action, institutionId, reportId, version, packageId, predecessor, digest, policy,
outcome, signer, authorityEpoch, nonce, deadline. Field identitas memakai string
UTF-8 yang sama persis dengan paket; predecessor kosong berarti tidak ada.
Digest adalah commitment HMAC-SHA256 paket beku, bukan hash dokumen tanpa salt.

Action pencatatan adalah `keccak256("RECORD_EVIDENCE")`. Kontrak menolak tujuan
lain, termasuk `PUBLISH_REPORT`. Penambahan publikasi kelak memerlukan tujuan
berbeda dan pemeriksaan dua kewenangan; tidak ada fungsi penerbitan pada ABI ini.
Nonce acak 32 byte sekali pakai berlaku per lembaga dan signer. Deadline API adalah
600 detik. Epoch kewenangan dibaca dari registry saat persiapan dan diperiksa ulang
saat eksekusi. Deadline, domain, epoch, nonce, signer, serta seluruh identitas dan
commitment ikut ditandatangani. Pengesahan workspace tidak berlaku di domain ini.

UI memverifikasi commitment paket sebelum menampilkan panel, menunjukkan draf,
manifest/cakupan, rekonsiliasi, temuan, dan parameter pengesahan sebelum signature.
Untuk EOA gunakan wallet terhubung. Untuk ERC-1271 gunakan wallet yang mendukung
alur tersebut atau salin typed data ke alur persetujuan akun kontrak dan tempel
signature hasilnya. Keduanya diperiksa melalui ABI `validateAuthorization` yang sama
dengan kontrak saat transaksi dijalankan. Salah magic value, revert, dan kegagalan
RPC menolak pengiriman. Akun kontrak tetap harus memiliki keanggotaan akses privat;
keanggotaan itu sendiri tidak memberi kewenangan chain. Bila registry dikonfigurasi,
verifikasi ERC-1271 untuk tantangan akses ruang kerja juga memakai RPC registry
tersebut agar akun kontrak tidak diperiksa pada deployment vault yang berbeda.

## API dan durability

Di bawah `/api/evidence/:preparationId/reports/:packageId/recording`:

- `POST {retryId,digest}` menyiapkan otorisasi untuk akun sesi. Paket wajib FROZEN
  dan digest wajib sama dengan paket yang ditinjau. Retry mempertahankan seluruh
  parameter, termasuk deadline dan epoch; tidak memperbaruinya diam-diam.
- `POST /:retryId/submit {signature}` memvalidasi kewenangan live dan signature.
  Field lain, termasuk status atau hash kiriman klien, ditolak.
- `POST /:retryId/retry {}` mengirim ulang byte transaksi durable tanpa meminta
  signature baru, termasuk sesudah tab/browser dimulai ulang. Akun sesi tetap
  harus cocok dengan pengesah tersimpan.
- `GET /:retryId` membaca receipt/event dari RPC dan menyimpan observasinya.
- `GET` mencantumkan percobaan paket dengan status yang diperiksa ulang.

`registry_intents` ber-FK ke paket dan lembaga. `registry_attempts` mempertahankan
signature, raw signed transaction, hash dan nonce. Lock row pada
`registry_relayer_nonces` menserialisasi alokasi nonce per deployment/akun relayer.
Signed bytes tersimpan **sebelum** broadcast; retry memakai byte dan hash identik.
Gunakan akun relayer khusus registry ini, jangan mengirim transaksi lain dengan
akun tersebut di luar allocator. Satu id retry dengan paket/digest/signer/signature
berbeda ditolak. Kontrak juga menolak pencatatan ulang identitas paket, walaupun
pemanggil membayar gas sendiri dengan nonce otorisasi baru.

Status `SUBMITTED` berarti byte transaksi diajukan atau percobaan tersimpan menunggu
receipt. `INCLUDED` membutuhkan receipt sukses, recipient registry, event dari
registry dengan action/lembaga/paket/digest/signer/authorization hash yang cocok,
serta blok canonical. `CONFIRMED` menambahkan kedalaman yang disyaratkan. Block
number/hash dan log index dibawa bersama transaction hash. Revert, event salah,
atau blok yang diketahui berubah tidak menghasilkan sukses. RPC gagal menghasilkan
503; UI menahan label sukses yang tidak dapat diperiksa. Riwayat raw percobaan
bertahan; observasi canonical terkini diperbarui pada pembacaan.

Jika acknowledgement hilang, periksa status dan kirim ulang pengesahan yang sama.
Sesudah reorg, receipt sebelumnya dibatalkan; byte yang sama dapat dikirim ulang
bila mandat, deadline dan nonce masih sah. Untuk otorisasi kedaluwarsa sebelum
pengiriman, mulai tinjauan baru secara eksplisit. Tidak ada fee bump/cancel otomatis;
transaksi dropped dengan nonce relayer yang belum dikonsumsi memerlukan operator
menyelesaikan nonce itu sebelum antrean selanjutnya dapat maju. Jangan menghapus
baris nonce atau mengklaim sukses untuk membuka antrean.

## Pengujian, skema dan pemulihan

Jalankan dari root:

```sh
FOUNDRY_INVARIANT_DEPTH=32 FOUNDRY_INVARIANT_RUNS=128 forge test --root sc --match-contract 'ReportEvidenceRegistry.*' --fuzz-runs 1000
python3 scripts/export-registry-abi.py
cd backend
bun test test/registry_api.test.ts
```

Tes HTTP memulai Anvil loopback pada port 18572, membuat registry dan mandat
sintetis, memakai kunci Anvil publik, serta PostgreSQL PGlite dalam direktori
sementara. Test membuktikan paket → signature → transaksi → receipt/event → status
pembaca; membuka ulang database; menguji EOA/ERC-1271, LOLOS/DITOLAK, kegagalan RPC,
acknowledgement hilang, dan reorg nyata. Foundry memanggil ABI secara langsung,
fuzz field terikat, serta invariant untuk isolasi lembaga, nonce dan immutable
history. ABI TypeScript diekspor dari artifact Solidity, bukan salinan manual.

Skema baru hanya `CREATE ... IF NOT EXISTS` dan unique index pada identitas paket.
Pemasangan mengikuti bootstrap workspace pada database yang dikonfigurasi; ticket
ini hanya menjalankannya pada database uji. Sebelum aktivasi nyata, backup database
beserta penyimpanan terenkripsi dan konfigurasi mandat. Pemulihan mempertahankan
intent, raw transaction, hash, nonce allocator, snapshot, dan salt bersama-sama;
baca ulang receipt canonical sebelum mengaktifkan kembali pengiriman. Jangan
mengubah manifest deployment vault atau menghapus bukti lama.

## Pemeriksaan browser opsional

Harness `frontend/test/registry-smoke.tsx` merender komponen laporan produksi
beserta koneksi wallet sintetis. Bila Playwright telah tersedia di lingkungan,
jalankan suite yang sama dengan `REGISTRY_BROWSER_MODULE` menunjuk modul
`playwright/index.mjs`; `REGISTRY_BROWSER_EXECUTABLE` dapat menunjuk Chromium lokal.
Tidak ada dependency browser baru yang diperlukan suite HTTP biasa.

Smoke check memeriksa checkbox review sebelum signing, pencatatan draf DITOLAK,
status inclusion/confirmation, pemulihan setelah sessionStorage dihapus, reorg
sesudah konfirmasi, serta pengiriman ulang byte tersimpan. Seluruh API, signature,
EVM dan database tetap fixture lokal yang sama. Screenshot disimpan di
`/tmp/ticket72-browser-smoke.png`.

## Bukti validasi implementasi 2026-09-08

- Foundry lokal: 73 tes lulus; dua kontrak tes fork Sepolia publik dikecualikan.
  Campaign invariant registry tambahan lulus 256 run / 128.000 panggilan tanpa
  revert tak terduga; fuzz field terikat memakai 1.000 run per properti.
- Backend lengkap dengan browser smoke: 467 lulus, 20 gagal. Seluruh 20 nama
  kegagalan juga terjadi pada commit awal `3ea2da8`, pada alur vault/layanan lama.
  Delapan tes HTTP/EVM registry dan satu smoke browser baru lulus.
- Frontend: 133 tes lulus; build Vite/client/SSR berhasil.
- Typechecking backend dan frontend dibandingkan dengan checkout terisolasi
  `3ea2da8`: tidak ada diagnostic baru; diagnostic lama masih ada.
- Review Standards dan Spec dilakukan terpisah. Tiga temuan recovery UI
  diperbaiki (retry pending, pemantauan sesudah konfirmasi, pemulihan riwayat
  durable); pemeriksaan ulang kedua review tidak menemukan temuan tersisa.
