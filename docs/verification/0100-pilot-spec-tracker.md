# Publikasi spec pilot dan penataan tracker — 2026-09-16

Pengguna meminta penutupan issue lama, mempertahankan pekerjaan selesai, dan penyesuaian kelanjutan #86 setelah brainstorming. Skill `to-spec` digunakan; batas pengujian dikonfirmasi pengguna: HTTP aplikasi dengan SQL/penyimpanan privat nyata, proof/verifier/NFT nyata pada EVM lokal, serta smoke browser alur penting.

## Spec dan amandemen

- [Spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100) diterbitkan dengan label `ready-for-agent`, 96 user stories dan 34 skenario penerimaan. Salinan isi yang cocok persis: [spec lokal](../specs/pilot-distribution-zk-nft.md).
- [#86](https://github.com/tawf-labs/tawf-zakat/issues/86) tetap OPEN sebagai fondasi operasional, ditambah amandemen/rujukan kelanjutan #100. Nomor user stories dan skenario baseline dipertahankan.
- #92–#99 tetap OPEN, kriteria awal dipertahankan seluruhnya, ditambah batas integrasi dan pengujian terkait pilot. Tidak ada penutupan atas pekerjaan yang belum selesai.
- #87–#91 tetap CLOSED; judul, isi, state dan waktu pembaruan tidak berubah.
- Kebutuhan baru pada #100 yang belum dimiliki #92–#99 tetap berada pada spec untuk pemecahan tiket berikutnya; belum dibuat tiket implementasi baru untuk semuanya.

| Tiket | Penyesuaian |
| --- | --- |
| #92 | Kontak/perwakilan terbatas dalam impor; tidak membuat identitas atau konfirmasi fiktif. |
| #93 | Hubungan kegiatan/versi/keputusan; tujuan pengesahan penyaluran berbeda dari sertifikat. |
| #94 | Realisasi IDR, OTP/BAST, uang muka, sengketa dan status terpisah. |
| #95 | Realisasi barang dan konfirmasi bersama; biaya/valuasi serta pertanggungjawaban tanpa hitung ganda. |
| #96 | Revisi/penutupan menjaga realisasi dan versi; berbeda dari koreksi kontribusi, pengalihan alokasi dan refund. |
| #97 | Diff penerima/kontak menjaga konfirmasi serta bukti versi asal. |
| #98 | Sumber laporan memakai realisasi/biaya/konfirmasi yang sama; batas laporan/ZK/NFT tetap berbeda. |
| #99 | Temuan/tanggapan audit menaut sengketa/bukti tanpa mengambil kewenangan operasional. |

## Issue lama yang ditutup

| Issue | Alasan | Dasar |
| --- | --- | --- |
| #55 | completed | #56–#60 CLOSED, implementasi hak amil 379c8d7 dan catatan verifikasi historis; rilis mengikuti #100. |
| #61 | completed | #62–#65 CLOSED; pekerjaan rilis yang dahulu #66 dipindahkan ke #100. |
| #66 | not_planned / superseded | Deployment lama digantikan penerimaan #100 AC32–AC34; tidak dinyatakan telah deploy. |
| #67 | completed | Implementasi c501ca9 dan integrasi #79/a5220eb. |
| #68 | completed | Seluruh irisan #69–#79 CLOSED; fondasi tetap dipakai. |
| #80 | completed | Implementasi 95ece1b/fdadffd serta catatan migrasi/verifikasi ef594df. |
| #81 | completed | Keempat irisan arsitektur #82–#85 sudah diimplementasikan. |
| #82 | completed | 3ca32d2 — pembacaan dokumen dari commitment kanonik. |
| #83 | completed | 89cbcf7 — akses sesi dan pemulihan draf. |
| #84 | completed | b3c497e — pembacaan versi pada acuan canonical yang sama. |
| #85 | completed | c2b9509 — lifecycle interaksi registry bersama. |

Setiap issue mendapat komentar bukti/batas klaim dan rujukan kelanjutan sebelum ditutup. Dasarnya implementasi serta catatan verifikasi yang sudah ada, bukan klaim pengujian/deployment baru. AC32–AC34 mempertahankan verifikasi URL publik, endpoint, LPZN golden case, validator, server secret, konfigurasi layanan, artefak teknis dan rencana migrasi/rollback. Asumsi lama “tanpa migrasi” tidak diteruskan ke skema pilot baru.

## Verifikasi setelah publikasi

- Isi #100 sama persis dengan berkas spec lokal, status OPEN dan label `ready-for-agent` benar.
- Isi sembilan amandemen (#86, #92–#99) sama persis dengan payload yang disiapkan. Semua acceptance criteria baseline tetap ada.
- Sebelas status/alasan penutupan serta komentar dibaca ulang dan cocok dengan rencana.
- Seluruh 13 sub-issue #87–#99 tetap terhubung ke #86. Sebelas relasi blocking langsung pada #92–#99 cocok dengan baseline: #92←#88/#89, #93←#91, #94←#93, #95←#94, #96←#94, #97←#92/#96, #98←#95/#96, #99←#98.
- Issue terbuka sesudah penataan: #86, #92–#99, #100.

SHA-256 isi spec yang dibaca ulang: `71c1e4026e54da8f21cb1e0298ba6f0916d5bfe2b06171133e0e938cf47febc7`.

Tidak ada perubahan kode aplikasi, tes runtime, migrasi, deployment, transaksi publik atau pesan kepada donor/mitra dalam sesi ini. Perubahan GitHub dan dokumentasi adalah hasil pekerjaan yang diminta.

Kelanjutan setelah persetujuan `to-tickets`: #101–#115 telah diterbitkan; lihat [catatan publikasi tiket](0101-pilot-tickets.md) untuk status dan dependensi sesudah langkah ini.
