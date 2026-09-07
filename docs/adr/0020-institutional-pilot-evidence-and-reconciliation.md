# ADR-0020: Pilot Lembaga Berfokus pada Bukti dan Rekonsiliasi

- Status: Accepted — batas produk; rancangan bukti diperinci melalui ADR-0021/0022.
- Date: 2026-09-08.
- Decider: pengguna, melalui penerimaan rekomendasi Q1 dan Q2 pada sesi `grill-with-docs`.

ZKT menargetkan **pilot lembaga untuk rekonsiliasi dan kesiapan audit**. Peran kontrak pada rilis terdekat adalah **mengikat bukti transaksi lembaga**; kebutuhan vault USDC dinilai sebagai alur tersendiri dengan kendali dana pada lembaga. Keputusan ini mengikuti posisi vendor teknologi dalam ADR-0016 dan memusatkan pekerjaan pada kebutuhan yang sudah terlihat dalam rekonsiliasi dan pelaporan.

Pilihan yang dipertimbangkan adalah memperbaiki sekaligus memperluas seluruh alur custody, atau mendahulukan lapisan bukti. Pengguna memilih rekomendasi kedua. Menambah tanggung jawab pencairan sekarang akan mengikat pilot pada aturan kewenangan dan pengelolaan dana yang belum diperlukan untuk membuktikan nilai rekonsiliasi.

## Hubungan dengan keputusan dan implementasi sebelumnya

- ADR-0016 tetap berlaku: lembaga mengelola dana, ZKT menyediakan teknologi.
- ADR-0005 dan ADR-0006 menjelaskan kebutuhan alur penyaluran yang sudah dibangun; keberadaan alur tersebut tidak membuat vault menjadi syarat pilot bukti. Ketidaksesuaian Solidity terhadap persetujuan DPS dan batas pengeluaran Amil tetap merupakan temuan terbuka bila alur itu digunakan.
- ADR-0019 tetap menjadi rujukan transport governance yang telah diimplementasikan. Perubahan fokus tidak memperbaiki kontrak yang sudah dideploy.
- ADR-0017 dan ADR-0018 tetap mendeskripsikan fitur v0 stateless. Pengguna menerima paket bukti periode dan pemisahan kewenangan/akses melalui [ADR-0021](0021-period-evidence-institutional-endorsement-and-private-sources.md), lalu registry terpisah, koreksi versi, dan penyimpanan temuan melalui [ADR-0022](0022-append-only-report-evidence-registry.md).
- Keputusan ini tidak memerintahkan penghapusan fitur vault, redeploy, migrasi data, atau aktivasi dana nyata. Registry pendamping dan gerbang penerbitan dengan pengesahan lembaga serta layanan validator telah dipilih melalui ADR-0022.

## Alasan penyelarasan

Pengguna menjelaskan bahwa beberapa bagian terlewat seiring pembaruan proyek. Inspeksi menemukan keputusan produk, kontrak, tes, dan dokumentasi yang berkembang tidak serempak. Perbaikan harus menghubungkan kebutuhan yang disepakati dengan aturan implementasi dan tes perilaku; label fitur selesai atau tes lama yang lulus tidak cukup membuktikan kesesuaian.

Lihat [riset sumber primer](../research/0003-smart-contract-primary-sources.md) dan [matriks kecocokan beserta frontier wawancara](../research/0004-smart-contract-project-fit-grilling.md). Glossary aktif berada di [CONTEXT.md](../../CONTEXT.md); konteks implementasi lama dipertahankan dalam [arsip](../../archive/CONTEXT-2026-09-08-before-pilot.md).
