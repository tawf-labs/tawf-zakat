# Handoff — Kabar & Laporan Pengajuan Kampanye

Dicatat: 9 Oktober 2026.

## Permintaan pengguna dan batas pekerjaan

Pengguna meminta ide ini dicatat untuk dikerjakan nanti, **bukan diimplementasikan sekarang**. Pengguna memperjelas istilahnya sebagai “kabar & laporan pengajuan”: perkembangan dan laporan realisasi yang melekat pada pengajuan kampanye infak yang sama, bukan membuat alur penyaluran lembaga baru.

## Arah fitur yang dibicarakan

- **Kabar:** perkembangan kegiatan atau kondisi terbaru kampanye.
- **Laporan realisasi:** penggunaan dana, tanggal pelaksanaan, hasil kegiatan, dan dokumentasi pendukung; misalnya bantuan telah dilaksanakan sesuai tujuan pengajuan.
- Penggalang mengirim kabar/laporan; operator memeriksa sebelum informasi diterbitkan ke publik.
- Tampilkan bagian **“Kabar & Laporan”** pada halaman detail kampanye. Dokumen sensitif tetap privat; tidak semua lampiran otomatis menjadi publik.
- Bedakan dana terkumpul, nominal yang dilaporkan digunakan, dan status pemeriksaan laporan. Pemeriksaan operator bukan jaminan kebenaran seluruh klaim.

Ini catatan arah produk, **belum spesifikasi implementasi final**. Detail jenis dokumen publik, revisi/koreksi laporan, perhitungan nominal, serta pencatatan blockchain perlu ditentukan saat pekerjaan dilanjutkan. Bukti blockchain, bila ditambahkan, tidak dengan sendirinya membuktikan bantuan sampai.

## Titik lanjut

**Pembaruan 12 Oktober 2026:** fitur dasar sudah diimplementasikan — lihat `backend/src/crowdfunding-updates.ts`, rute `…/campaigns/:id/updates` di `backend/src/routes/crowdfunding.ts`, dan `frontend/src/features/crowdfunding/CampaignUpdates.tsx`. Keputusan yang diambil saat implementasi: kabar terbit langsung oleh penggalang tanpa pemeriksaan operator (hanya foto sebagai lampiran, operator dapat menarik), sedangkan laporan realisasi tetap diperiksa lebih dulu; lampiran laporan privat secara bawaan dan publik hanya atas usulan penggalang plus pelepasan operator; catatan terbit tidak diubah, melainkan dikoreksi lewat catatan pengganti atau ditarik operator; nominal dilaporkan digunakan = jumlah laporan realisasi terbit yang belum digantikan, dibatasi dana terkumpul. Istilahnya ada di `CONTEXT.md`.

Masih terbuka: pencatatan kabar/laporan ke registry blockchain (sengaja belum ada event outbox), keterkaitan dengan alur bukti lembaga lama, dan notifikasi kepada donatur. Revisi proposal kampanye tetap bukan fitur laporan realisasi.

Implementasi dasar sebelumnya telah di-commit pada branch `feat/crowdfunding-campaigns`, commit `d4bb6f9` (`feat: add infak crowdfunding with payments, evidence registry and landing integration`). Pada akhir giliran commit, belum ada push; periksa Git kembali sebelum bekerja karena status dapat berubah.

Baca sumber berikut alih-alih mengandalkan ringkasan ini sebagai status kode terbaru:

- `CONTEXT.md` — istilah kampanye, penggalang, operator, pemeriksaan, donasi terkonfirmasi, dan bukti pencatatan.
- `README.md` — implementasi dan batasan crowdfunding.
- `backend/src/crowdfunding.ts`, `backend/src/routes/crowdfunding.ts` — model dan API kampanye.
- `backend/src/crowdfunding-documents.ts` — penanganan dokumen privat.
- `frontend/src/features/crowdfunding/ManageCampaigns.tsx` — pengelolaan oleh penggalang/operator.
- `frontend/src/features/crowdfunding/CampaignDetail.tsx` — detail publik.
- `backend/src/campaign-chain.ts` dan `docs/deployments/2026-10-09-campaign-registry-arbitrum-sepolia.json` — adapter dan catatan deployment; periksa status runtime secara terpisah bila relevan.
- `docs/adr/0041-penerbitan-pengajuan-atas-keputusan-internal-lembaga.md` — jangan mencampur keputusan pengajuan lembaga dengan publikasi kampanye infak.

Pertahankan landing utama existing dan integrasi card kampanye; jangan mengganti keseluruhan beranda. Jangan mengubah data, men-deploy ulang kontrak, atau menyiarkan transaksi hanya untuk melanjutkan catatan ini. Jangan memasukkan `.env`, password, atau private key ke handoff/commit.

## Suggested skills

- `domain-modeling` — menajamkan batas kabar, laporan realisasi, dan pemeriksaan.
- `to-spec` — bila pengguna meminta spesifikasi sebelum implementasi.
- `implement` dan `tdd` — setelah pengguna memberi izin implementasi.
- `ui-ux-pro-max` — integrasi UI pengelolaan dan riwayat publik dengan desain existing.
- `ethskills` — hanya jika pekerjaan benar-benar menyentuh pencatatan blockchain.
