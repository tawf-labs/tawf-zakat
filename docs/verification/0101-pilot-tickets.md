# Publikasi tiket pilot — 2026-09-16

Pengguna menyetujui pembagian 15 tiket melalui skill `to-tickets`, termasuk hubungan sub-issue ke spec #100 dan pemakaian kembali tiket operasional lama. Persetujuan terakhir: “baiklah gas saya setuju”.

## Hasil

- [Spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100) memiliki 15 sub-issue baru, #101–#115, semuanya OPEN dengan label `ready-for-agent`.
- Sebanyak 29 relasi blocking native pada tiket baru cocok dengan pembagian yang disetujui. Referensi draf N01–N15 pada body sudah diganti nomor issue nyata.
- #87–#91 tetap CLOSED; #92–#99 tetap OPEN dan berada di bawah #86. Sebelas relasi blocking langsung pada #92–#99 tetap sesuai baseline, termasuk blocker yang sudah selesai.
- Judul, body, label dan state #86–#100 cocok dengan snapshot sebelum publikasi tiket. Penambahan relasi sub-issue #100 tidak mengubah isi spec.
- Seluruh graph tidak bersiklus. #115 bergantung secara langsung atau transitif pada 14 tiket baru lainnya dan seluruh #92–#99.
- Tiket tanpa blocker terbuka: #92, #93, #101, #102.

[Indeks tiket dan matriks keterlacakan](../design/pilot-distribution-tickets.md) memetakan seluruh 96 user stories dan 34 acceptance criteria pada spec #100. Ini cakupan rencana implementasi, bukan klaim fitur selesai atau tes aplikasi sudah lulus.

## Pembacaan ulang tracker

Waktu verifikasi UTC: 2026-09-16T13:43:11.607383+00:00.

Pembacaan ulang melalui GitHub CLI memeriksa judul, body persis, label, state, daftar sub-issue kedua parent, serta daftar blocker native setiap tiket terbuka. Body akhir dibandingkan dengan payload publikasi dan hash berikut; parent/issue lama dibandingkan snapshot sebelum publikasi.

| Issue | Blocked by | SHA-256 body |
| --- | --- | --- |
| [101](https://github.com/tawf-labs/tawf-zakat/issues/101) | Tidak ada | `b149cb3919211c81ed6b74efe8d7c7af0bf985e0d9a8222ddd7bcc47aae658ab` |
| [102](https://github.com/tawf-labs/tawf-zakat/issues/102) | Tidak ada | `00a00d03dab90987996d96096ef5b10dad5e13d7c5e1e9a73888829731062ec2` |
| [103](https://github.com/tawf-labs/tawf-zakat/issues/103) | #102, #93 | `e71e6ca3f92b16bcc640bbc07993d6ac5fe88d9ec092256668b43bf8e028ae64` |
| [104](https://github.com/tawf-labs/tawf-zakat/issues/104) | #101, #103 | `40a5629aacc39602d0340ca223bdd80428064d4124305f16c4843a7b25a0f3f0` |
| [105](https://github.com/tawf-labs/tawf-zakat/issues/105) | #104 | `13faf72b45e6ac53c1b4d535118b13b702fd39d1734bbbfba25eb604be7b0cdd` |
| [106](https://github.com/tawf-labs/tawf-zakat/issues/106) | #103 | `80cdeef2821875dd29e687d1d0856ba864cf41b2ff0d0378d979e7ef4e7f8cc3` |
| [107](https://github.com/tawf-labs/tawf-zakat/issues/107) | #106, #95, #96 | `c0f0cb91dace288dfe1c52fbd44aacc9a692bf8fcea2b5a06000be0ec7b30502` |
| [108](https://github.com/tawf-labs/tawf-zakat/issues/108) | #101, #102 | `ad95f6a91fec9a17e843d21419bbc303ca63a9e6e4c0146172716567c333ab44` |
| [109](https://github.com/tawf-labs/tawf-zakat/issues/109) | #108 | `8270c9ce8e5a89a994b91f6b9e99786e63645cb7358917b09ea8e12f3f30be2e` |
| [110](https://github.com/tawf-labs/tawf-zakat/issues/110) | #106, #109 | `a0c8767dd1105d3e989cd2b17a3c4e5b47eca27cf7369d2a3ebb797a03b0824f` |
| [111](https://github.com/tawf-labs/tawf-zakat/issues/111) | #101, #95 | `6321764bfdf71c37fb286b98bb749339568c4032c0cccda3f9ea7636e7d5072e` |
| [112](https://github.com/tawf-labs/tawf-zakat/issues/112) | #111, #96 | `bfb7bb57451d89de45301b4ea12969bfc78d3f26534aafde1b59645acc2ab3af` |
| [113](https://github.com/tawf-labs/tawf-zakat/issues/113) | #112 | `010942228323a0353867fb5896441b460e4f33e4c96da4bc2d306155b881a1af` |
| [114](https://github.com/tawf-labs/tawf-zakat/issues/114) | #104, #107, #110, #112, #98 | `64784676fa46e327dc7c9245a9b9a2036511b4ad0728fbaf0f29bbbf4c7a35dd` |
| [115](https://github.com/tawf-labs/tawf-zakat/issues/115) | #105, #113, #114, #97, #99 | `53538dc93594b55f908255d36eec29ce52dc2d45241d8bdebae4581ae59008df` |

## Batas verifikasi

Pemeriksaan lokal meliputi cakupan spec, tautan dokumentasi, dan whitespace. Tidak ada perubahan kode aplikasi, tes runtime, deployment, migrasi atau transaksi publik pada langkah publikasi tiket ini. Catatan langkah sebelumnya tersedia pada [publikasi spec dan penataan tracker](0100-pilot-spec-tracker.md).
