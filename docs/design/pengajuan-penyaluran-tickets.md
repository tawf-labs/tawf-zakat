# Tiket pengajuan penyaluran lembaga

Tanggal publikasi dan verifikasi: 2026-09-15. Sumber: [spec #86](https://github.com/tawf-labs/tawf-zakat/issues/86), [rancangan UX](pengajuan-penyaluran-ux.md), dan [riset 0005](../research/0005-pengajuan-penyaluran-dan-ux-grilling.md).

Pengguna menyetujui penggabungan usulan 15 menjadi 13 tiket melalui jawaban **“ya saya setuju”**. Semua tiket diterbitkan melalui `to-tickets`, berlabel `ready-for-agent`, dengan relasi sub-issue serta dependensi native GitHub. Status di sini adalah snapshot publikasi; gunakan tracker untuk status pekerjaan terkini.

## Sinkronisasi pilot — 2026-09-16

[Spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100) diterbitkan sebagai kelanjutan pilot distribusi, penelusuran, ZK dan NFT. #86 serta #92–#99 mendapat amandemen; #87–#91 tetap CLOSED tanpa perubahan. Relasi sub-issue dan dependensi native dipertahankan. Referensi US/skenario pada tabel di bawah tetap penomoran baseline #86, sedangkan spec #100 mempunyai penomoran tersendiri.

#82–#85 dan parent #81 sudah ditutup berdasarkan implementasi tersimpan. Pernyataan tentang status OPEN di bagian publikasi awal di bawah merupakan riwayat 2026-09-15. [Catatan sinkronisasi](../verification/0100-pilot-spec-tracker.md) memuat penutupan issue lama, perubahan tiap tiket dan hasil pembacaan ulang GitHub.

## Peta pekerjaan

| Tiket | Hasil | Terblokir oleh |
| --- | --- | --- |
| T01 · [#87](https://github.com/tawf-labs/tawf-zakat/issues/87) | Akun kerja pribadi dan header identitas lembaga | Tidak ada |
| T02 · [#88](https://github.com/tawf-labs/tawf-zakat/issues/88) | Impor sumber laporan XLSX/CSV sampai snapshot yang dapat diperiksa | Tidak ada |
| T03 · [#89](https://github.com/tawf-labs/tawf-zakat/issues/89) | Program bantuan dan draf pengajuan banyak penerima | [#87](https://github.com/tawf-labs/tawf-zakat/issues/87) |
| T04 · [#90](https://github.com/tawf-labs/tawf-zakat/issues/90) | Mandat operasional dan akun pengesahan lembaga | [#87](https://github.com/tawf-labs/tawf-zakat/issues/87) |
| T05 · [#91](https://github.com/tawf-labs/tawf-zakat/issues/91) | Dokumen pengajuan dan pemeriksaan kelayakan | [#89](https://github.com/tawf-labs/tawf-zakat/issues/89), [#90](https://github.com/tawf-labs/tawf-zakat/issues/90) |
| T06 · [#92](https://github.com/tawf-labs/tawf-zakat/issues/92) | Impor daftar penerima dengan validasi massal | [#88](https://github.com/tawf-labs/tawf-zakat/issues/88), [#89](https://github.com/tawf-labs/tawf-zakat/issues/89) |
| T07 · [#93](https://github.com/tawf-labs/tawf-zakat/issues/93) | Keputusan lembaga dan pengesahan pencatatan pengajuan | [#91](https://github.com/tawf-labs/tawf-zakat/issues/91) |
| T08 · [#94](https://github.com/tawf-labs/tawf-zakat/issues/94) | Realisasi IDR bertahap dan bukti pembayaran | [#93](https://github.com/tawf-labs/tawf-zakat/issues/93) |
| T09 · [#95](https://github.com/tawf-labs/tawf-zakat/issues/95) | Realisasi bantuan barang dengan satuan dan bukti penyerahan | [#94](https://github.com/tawf-labs/tawf-zakat/issues/94) |
| T10 · [#96](https://github.com/tawf-labs/tawf-zakat/issues/96) | Revisi, pembatalan, dan penutupan sisa pengajuan | [#94](https://github.com/tawf-labs/tawf-zakat/issues/94) |
| T11 · [#97](https://github.com/tawf-labs/tawf-zakat/issues/97) | Unggah ulang penerima dengan pratinjau perubahan dan revisi | [#92](https://github.com/tawf-labs/tawf-zakat/issues/92), [#96](https://github.com/tawf-labs/tawf-zakat/issues/96) |
| T12 · [#98](https://github.com/tawf-labs/tawf-zakat/issues/98) | Sumber laporan dari realisasi dan penelusuran bukti | [#95](https://github.com/tawf-labs/tawf-zakat/issues/95), [#96](https://github.com/tawf-labs/tawf-zakat/issues/96) |
| T13 · [#99](https://github.com/tawf-labs/tawf-zakat/issues/99) | Temuan auditor, tanggapan amil, dan tindak lanjut pemeriksaan | [#98](https://github.com/tawf-labs/tawf-zakat/issues/98) |

## Penggabungan yang disepakati

- T10 lama (revisi) dan T11 lama (pembatalan/penutupan sisa) menjadi T10: satu siklus perubahan pengajuan, persetujuan ulang, dan riwayat yang konsisten.
- T14 lama (temuan auditor) dan T15 lama (tanggapan/tindak lanjut) menjadi T13: satu siklus pemeriksaan yang dapat didemokan sampai tindak lanjut auditor.
- T12 lama menjadi T11; T13 lama menjadi T12. T01–T09 mempertahankan cakupannya.

## Urutan dan batas dependensi

Mulai paralel dari [#87](https://github.com/tawf-labs/tawf-zakat/issues/87) untuk identitas akun/header dan [#88](https://github.com/tawf-labs/tawf-zakat/issues/88) untuk impor sumber laporan. Setelah itu ambil tiket yang seluruh blockernya sudah selesai. Label `ready-for-agent` menyatakan tiket siap diambil secara spesifikasi; dependensi tetap menentukan kapan implementasi bisa dimulai.

T02 dapat didemokan dengan akses ruang kerja yang sudah tersedia. T06 memakai pembaca tabular T02 dengan validasi penerima tersendiri. T09 dan T10 bisa berjalan paralel setelah T08; T10 memakai aturan bantuan bersatuan dengan demo IDR. T12 memerlukan realisasi barang dan revisi, sedangkan adapter sumber internalnya tidak memerlukan impor spreadsheet T02.

Tiket #82–#85 tetap menjadi pemilik pekerjaan arsitektur yang sudah tercatat. Irisan baru memakai antarmuka akses, dokumen terbatas, versi laporan, dan lifecycle registry yang tersedia; status OPEN tiket lama saja tidak dijadikan blocker tambahan.

## Keterlacakan ke spec

Referensi di bawah menyatakan kontribusi tiap tiket; skenario lintas alur dapat muncul pada beberapa tiket. Pemetaan mencakup seluruh 60 user stories dan 26 skenario penerimaan.

| Tiket | User stories | Skenario penerimaan |
| --- | --- | --- |
| T01 | US-01, US-02, US-04, US-06, US-07, US-08, US-45, US-48, US-58, US-59 | 10, 11, 24, 25 |
| T02 | US-21, US-22, US-23, US-24, US-25, US-49, US-50, US-57, US-58, US-59, US-60 | 4, 5, 6, 15, 19, 20, 23, 25 |
| T03 | US-02, US-09, US-10, US-11, US-12, US-13, US-14, US-16, US-17, US-18, US-19, US-35, US-48, US-58, US-59, US-60 | 1, 2, 3, 15, 24, 25, 26 |
| T04 | US-05, US-06, US-07, US-08, US-31, US-33, US-48 | 10, 11, 12, 24, 25 |
| T05 | US-03, US-08, US-15, US-20, US-28, US-29, US-30, US-34, US-58, US-59 | 2, 3, 8, 9, 11, 20, 23, 25 |
| T06 | US-12, US-21, US-22, US-23, US-24, US-25, US-28, US-58, US-59 | 4, 5, 6, 8, 15, 25 |
| T07 | US-31, US-32, US-33, US-34, US-35, US-45, US-48 | 9, 10, 11, 12, 24, 25 |
| T08 | US-16, US-17, US-36, US-37, US-38, US-39, US-40, US-41, US-45, US-46, US-47, US-55, US-58, US-59 | 13, 14, 15, 16, 23, 24, 25 |
| T09 | US-16, US-37, US-38, US-39, US-40, US-41, US-46, US-47, US-55, US-58, US-59 | 13, 14, 15, 16, 25, 26 |
| T10 | US-34, US-42, US-43, US-44, US-50, US-55 | 9, 12, 17, 18, 19, 25 |
| T11 | US-26, US-27, US-42, US-47, US-50 | 7, 17, 19, 24, 25 |
| T12 | US-49, US-50, US-51, US-55, US-57, US-60 | 15, 19, 20, 22, 23, 25, 26 |
| T13 | US-03, US-51, US-52, US-53, US-54, US-55, US-56, US-57, US-58, US-59 | 11, 20, 21, 22, 23, 24, 25 |

## Verifikasi publikasi

- 13 issue OPEN, judul/isi sesuai draf, dan label `ready-for-agent` telah dibaca kembali dari GitHub.
- 13 relasi sub-issue ke #86 dan 15 relasi blocking langsung telah dibaca kembali; setiap daftar blocker cocok dengan rencana.
- Judul, isi, dan status parent #86 tetap sama setelah publikasi.
- Cakupan ID user stories/skenario dan urutan blocker diperiksa secara struktural. Ini verifikasi perencanaan; pengujian implementasi belum dijalankan.

Batas pengujian implementasi mengikuti spec yang telah disetujui: HTTP aplikasi terautentikasi, SQL/berkas privat/aturan nyata, smoke browser, dan harness registry lokal untuk integrasi yang tersentuh. Setiap tiket memuat kriteria penerimaan dan pengujiannya sendiri. Publikasi ini belum mengimplementasikan fitur.
