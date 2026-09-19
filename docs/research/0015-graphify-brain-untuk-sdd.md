# Graphify brain untuk alur SDD ZKT

Tanggal: 2026-09-18. Dasar: Graphify lokal **0.9.63**, skill terpasang, sumber upstream, dokumen working tree pada HEAD `b6f5c147dbdb520879244b716dc6f916546414f3`, serta pembacaan GitHub melalui `gh`. Ini rekomendasi pengelolaan pengetahuan, bukan keputusan perubahan produk atau bukti pengujian aplikasi baru.

## Rekomendasi

Jadikan `~/Dev/brain/projects/zkt-hackathon/` corpus pengetahuan khusus proyek. Simpan salinan nyata sumber yang dipilih, provenance, dan insight yang dapat ditelusuri. Pertahankan spec/tiket di GitHub dan domain docs di repo. Graphify menghasilkan indeks turunan yang dapat dibangun ulang; perubahan keputusan tetap dilakukan pada sumbernya.

Mulai dengan graph spec/domain/evidence. Tambahkan graph kode secara terpisah ketika ada pertanyaan implementasi yang memerlukannya. Memindai seluruh `~/Dev` akan mencampur proyek, dependency, arsip, dan salinan skill yang tidak membantu memahami pilot. Rancangan ini merupakan rekomendasi untuk kondisi ZKT, bukan standar resmi bernama “Graphify brain”.

```text
~/Dev/brain/
  projects/zkt-hackathon/
    README.md
    sources/
      github/issues/       # #86–#117, body dan komentar dibedakan
      repository/          # CONTEXT.md dan docs terpilih, salinan nyata
    insights/              # analisis bertanggal + tautan sumber
    metadata/              # manifest, raw snapshot, typed relations
    .graphifyignore
    graphify-out/          # JSON, report, HTML, cache hasil build
```

Nama lokal proyek tetap `zkt-hackathon`; URL issue yang dikembalikan GitHub sekarang memakai `tawf-labs/tawf-zakat`. Catat alias ini dalam metadata dan gunakan URL hasil API sebagai identitas sumber, supaya rename repository tidak membuat dua Issue 100 yang seolah berbeda.

## Kesesuaian dengan SDD Matt Pocock

Alur upstream `to-spec` menyimpan spec pada tracker serta memakai glossary/ADR proyek. `to-tickets` membaginya menjadi irisan end-to-end dengan blocking edges dan bekerja dari frontier tiket yang blockernya selesai. Brain dapat membantu mengambil konteks lintas sumber sebelum mengerjakan irisan tersebut. Ia tidak perlu menjadi tracker ketiga atau alasan memecah tiket kembali berdasarkan lapisan teknis. [Sumber spec](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/to-spec/SKILL.md), [sumber tickets](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/to-tickets/SKILL.md).

Paket konteks yang berguna sebelum mengerjakan tiket: kontrak perilaku tiket, US/AC spec induk yang relevan, blocker/interface yang dipakai ulang, ADR aktif, istilah domain, serta bukti verifikasi dan batasnya. Tautan kode boleh berada pada insight implementasi dengan commit/provenance; tidak perlu memasukkan semua nama berkas ke spec produk yang mudah kedaluwarsa.

## Fakta yang harus dipertahankan brain

| Sumber | Peran | Cara memperlakukannya |
| --- | --- | --- |
| GitHub spec/tiket | Kontrak perilaku, scope, state tracker | Ambil OPEN dan CLOSED, body, komentar, label, updatedAt, sub-issue dan blocker native. |
| `CONTEXT.md` | Istilah domain | Pertahankan makna dan bagian `Avoid`; jangan gabungkan sinonim yang dilarang. |
| `docs/adr` | Keputusan dengan scope/status | Simpan hubungan extends/refines/supersedes secara spesifik, termasuk penggantian parsial. |
| `docs/design`, `docs/specs` | Rancangan dan salinan spec | Bedakan detail yang diterima dari pilihan yang masih terbuka; hindari hitung salinan sebagai bukti independen. |
| `docs/verification` | Catatan pengujian tertentu | Simpan tanggal, build, lingkungan, hasil dan keterbatasan. Lulus historis bukan lulus saat ini. |
| `docs/research` | Bukti, alternatif dan riwayat analisis | Rekomendasi riset tidak otomatis menjadi keputusan produk. |
| Kode dan tes | Implementasi yang bisa diperiksa | Baca pada revisi jelas; keberadaan tes berbeda dari hasil menjalankannya. |
| `archive`, README historis | Konteks lama | Keluarkan dari corpus awal; masukkan terarah sebagai historis jika dibutuhkan. |

Untuk sumber repo, simpan path asli, hash isi, HEAD dan keterangan bahwa salinan berasal dari working tree. HEAD sendirian tidak menjamin file bersih. Untuk GitHub, simpan URL, updatedAt, state dan komentar dengan URL masing-masing. Waktu fetch masuk manifest terpisah agar polling tidak mengubah semua dokumen dan membatalkan cache semantik.

## Insight spesifik #86, #100, dan issue setelah #100

**#100 melanjutkan #86 dan memakai fondasinya.** #86 tetap OPEN, bukan spec yang seluruhnya dibatalkan. #87–#99 adalah 13 child native #86. #101–#115 adalah 15 child native #100. Nomor US/AC masing-masing spec berdiri sendiri; gunakan identitas seperti `zkt:spec:86:AC01` dan `zkt:spec:100:AC01`. Ini konvensi identitas yang disarankan, bukan format wajib Graphify. [Spec #86](https://github.com/tawf-labs/tawf-zakat/issues/86), [spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100).

Snapshot 18 September menunjukkan #87–#98 dan #101–#103 CLOSED; #99, #104–#117 masih OPEN. Catatan publikasi [0101](../verification/0101-pilot-tickets.md) menyebut semua tiket baru OPEN pada 16 September. Kedua sumber konsisten jika dibaca dengan tanggal; jangan memasukkan state historis sebagai state tracker sekarang.

**Frontier dependensi native saat dibaca:** #99, #104, #106, #108, #111 tidak mempunyai blocker terbuka. #116/#117 juga tidak punya blocker native, tetapi merupakan tindak lanjut dengan kebutuhan triase sendiri. Frontier ini hanya menunjukkan keadaan dependensi; bukan bukti tiket belum diklaim, prioritas final, atau kesiapan lingkungan. Parent #86/#100 dikeluarkan dari daftar pekerjaan implementasi.

**Jalur ZK dan NFT berbeda.** #108 → #109 → #110 menangani proof kontribusi dan koreksinya; #111 → #112 → #113 menangani sertifikat distribusi/NFT dan pemulihan. NFT tidak bergantung pada selesainya ZK. Keduanya bertemu pada integrasi #114 dan gerbang rilis #115. Alokasi #103 menjembatani penerimaan kontribusi dengan kegiatan berbasis pengajuan #93. Ini alasan peta brain harus melintasi kedua spec, bukan hanya membaca #100 dan child-nya. [Matriks tiket](../design/pilot-distribution-tickets.md), [ADR-0034](../adr/0034-private-contribution-membership-zk-priority.md), [ADR-0035](../adr/0035-staged-distribution-certificates-and-required-pilot-nft.md).

**#116 dan #117 wajib masuk corpus.** #116 mengungkap bahwa penyembunyian rincian donor pada #101 masih menyisakan enumerasi referensi publik. Body #116 mencantumkan parent #100, tetapi daftar sub-issue native #100 yang dibaca belum memuat #116. Catat `declares_parent` terpisah dari `native_child_of`, bukan memperbaiki tracker diam-diam. #117 mencatat error React saat reload dan tidak mencantumkan parent; hubungannya dengan #102 berasal dari komentar penutupan #102. [#116](https://github.com/tawf-labs/tawf-zakat/issues/116), [#117](https://github.com/tawf-labs/tawf-zakat/issues/117), [#102](https://github.com/tawf-labs/tawf-zakat/issues/102).

**Ada kandidat rekonsiliasi pengetahuan:** #117 masih OPEN, sedangkan [catatan verifikasi #103](../verification/0103-activity-allocation.md) memuat perbaikan reconnect/hydration dan hasil reload. Ini alasan menelaah reproduksi #117 terhadap kode saat ini, bukan bukti otomatis bahwa bug yang sama selesai. Simpan kedua observasi beserta lingkup tesnya.

**Pisahkan jenis klaim.** Proof membership kontribusi bukan bukti penyerahan fisik; NFT tahap bukan penerbitan laporan periode; pengesahan laporan dan atestasi auditor berbeda; CLOSED bukan indikator seluruh pilot siap. Model hubungan yang menyatukan semuanya sebagai `verified` akan menyesatkan meskipun grafnya terlihat rapi. [ADR-0022](../adr/0022-append-only-report-evidence-registry.md), [ADR-0033](../adr/0033-pilot-activity-allocation-confirmation-and-publication.md), [ADR-0034](../adr/0034-private-contribution-membership-zk-priority.md), [ADR-0035](../adr/0035-staged-distribution-certificates-and-required-pilot-nft.md).

## Model relasi dan pemeriksaan mutu

Pertahankan relasi eksplisit `native_child_of`, `declares_parent`, `blocked_by`, `covers_requirement`, `governed_by`, `verified_by`, dan `supersedes`. Untuk klaim implementasi, bedakan `reported_implemented_by` dari implementasi yang sudah ditelaah langsung. Setiap relasi memerlukan sumber; relasi hasil interpretasi diberi penanda INFERRED atau AMBIGUOUS sesuai bukti.

Hubungan dari API GitHub dan cakupan US/AC eksplisit sebaiknya juga disimpan deterministik dalam tabel/JSON pendamping. Graphify berguna untuk navigasi semantik; penghitungan coverage dan frontier tidak perlu bergantung pada apakah LLM mengekstrak semua nomor dengan benar. `EXTRACTED` berarti dinyatakan sumber, bukan kebenaran dunia nyata yang telah diuji.

Graph dinyatakan berguna setelah mampu menjawab dengan sumber:

1. Apa yang dilanjutkan #100 dari #86, dan apa yang tetap berlaku?
2. US/AC milik spec mana yang dicakup #108 dan #111?
3. Apakah #111 menunggu #108? Apa blocker sebenarnya?
4. Mengapa #101 selesai tetapi #116 masih diperlukan?
5. Apa bukti dan batas pengujian #103? Bagaimana kaitannya dengan #117?
6. Apa yang menahan #115, tanpa menyamakan CLOSED dengan hasil tes terbaru?

## Caveat Graphify 0.9.63 yang memengaruhi setup

- **Gunakan salinan nyata.** Detector lokal tidak mengikuti symlink secara default dan menolak target di luar root corpus, termasuk ketika mengikuti symlink diaktifkan. Symlink `brain/docs → repo/docs` tidak cukup. [Detector upstream](https://raw.githubusercontent.com/Graphify-Labs/graphify/v8/graphify/detect.py).
- **Skill berbeda dari CLI.** Skill agen mengorkestrasi ekstraksi semantik dokumen melalui model sesi; terminal `graphify extract` mempunyai workflow/backend sendiri. API key tambahan bukan prasyarat memakai skill. Dokumentasi opsi harus dibaca sesuai workflow. [Graphify upstream](https://github.com/Graphify-Labs/graphify), [paket versi diperiksa](https://pypi.org/project/graphifyy/0.9.63/).
- **Jalankan dari direktori proyek brain.** Skill terpasang banyak menulis literal `graphify-out/` relatif ke working directory. Jangan mengandalkan argumen path saja untuk menentukan lokasi output. Output/cache tiap corpus harus terpisah.
- **Direction penting.** Skill mendukung `--directed`; CLI `extract` lokal tidak mengenal flag tersebut. `merge-graphs` lokal menormalkan graph menjadi undirected. Simpan arah blocker pada graph proyek dan typed-relation JSON; graph global gabungan bukan dasar perhitungan dependensi.
- **Bukan jaminan multigraph.** Beberapa relasi berbeda pada pasangan node yang sama dapat terlipat dalam Graph/DiGraph. Simpan semua relasi dalam artefak pendamping sebelum ekspor, lalu audit hasilnya.
- **Refresh sumber mendahului refresh graph.** `watch`/update AST bukan sinkronisasi issue GitHub dan bukan pengganti ekstraksi semantik ulang dokumen. Skill `--update` menangani perubahan/deletion corpus; pertahankan root dan arah graph. Periksa shrink guard sebelum memaksa rebuild.
- **Query punya batas.** CLI lokal memakai depth 2 dan default budget 2000; pencarian tidak otomatis menyamakan sinonim atau bahasa. Cari `Issue 100`, judul tiket, nomor ADR dan istilah glossary; perluas kosakata sebelum menyimpulkan tidak ada hubungan.
- **Global brain tidak otomatis memakai folder pengguna.** Implementasi global bawaan menulis `~/.graphify/global-graph.json`. Folder `~/Dev/brain` adalah tata kelola corpus pilihan kita. Mulai dengan graph per proyek dan path eksplisit. [Implementasi global upstream](https://raw.githubusercontent.com/Graphify-Labs/graphify/v8/graphify/global_graph.py).

Detail lokal di atas diverifikasi pada instalasi 0.9.63 oleh riset sumber/CLI, bukan janji semua versi sama. URL branch upstream dapat berubah; catat versi saat upgrade. Simpan cache semantik beserta identitas prompt; jangan menulis ulang semua snapshot hanya untuk memperbarui waktu fetch.

## Siklus pemakaian yang disarankan

1. **Sync:** baca seluruh issue OPEN/CLOSED, pilih #86, #100 dan semua nomor >100; tambahkan #87–#99 serta referensi relevan ketika dibutuhkan. Ambil relasi native terpisah. Jangan menganggap nomor PR sebagai issue atau nomor besar sebagai child otomatis.
2. **Snapshot:** tulis body/komentar lengkap dan salinan dokumen repo; catat hash, waktu sumber, revisi dan relasi dalam manifest. Isi tak berubah tidak ditulis ulang. Salinan lokal #100 saat riset cocok dengan body GitHub setelah whitespace akhir diabaikan, sehingga cukup indeks body GitHub dan simpan alias dokumen lokal.
3. **Curate:** pertahankan insight dengan sumber dan tanggal; jangan menimpa insight lama sebagai fakta terkini hanya karena sync dijalankan. Tandai bila hash sumber berubah.
4. **Build:** buka sesi agen dari `~/Dev/brain/projects/zkt-hackathon`, lalu minta skill Graphify membangun `.` dengan `--directed`. Ini instruksi kepada skill, bukan sintaks terminal `graphify extract`. Build semantik penuh pertama belum dijalankan dalam riset ini.
5. **Query:** sesudah graph tersedia, gunakan `graphify query "Issue 100" --budget 3000` dari direktori yang sama, kemudian telusuri sumber hasilnya. Gunakan `path`/`explain` untuk pertanyaan terfokus.
6. **Update:** setelah perubahan sumber, sync dahulu lalu jalankan skill `--update --directed`; audit node hilang, konflik, dan provenance. Pembaruan lokal tidak mengubah GitHub dengan sendirinya.

Corpus awal mengabaikan metadata mentah, graphify-out, exports, dependency, `.agents`, `.codex`, `.scratch`, arsip dan berkas privat. Obsidian/wiki/Neo4j belum diperlukan; jika memakai ekspor, jangan indeks kembali output tersebut sebagai sumber baru. Markdown insight cukup untuk mulai memakai brain tanpa menambah sistem yang harus dipelihara.

## Batas pekerjaan ini

Pembacaan tracker mencakup seluruh 32 issue #86–#117 dan 34 daftar relasi native. Seluruh issue >100 yang ditemukan adalah #101–#117. Tidak ada perubahan tracker, commit/push, tes runtime, deployment, atau audit implementasi baru. Insight adalah analisis sumber; hasil build graph dan evaluasi kualitas retrieval tetap langkah terpisah. Dokumen historis dipertahankan sebagai historis, termasuk bila statusnya sudah berubah.

## Kelanjutan: build pertama selesai

Atas permintaan lanjutan pengguna pada 2026-09-18, graph semantik berarah telah dibangun di `~/Dev/brain/projects/zkt-hackathon/graphify-out/`: **1.262 node, 2.190 edge, 96 komunitas, 119 dokumen**. Pemeriksaan eksak memverifikasi 32 issue, seluruh 72 relasi native, 60 US dan 26 AC #86, serta 96 US dan 34 AC #100. Semua 119 entri cache semantik tetap terbaca setelah dipindahkan ke lokasi final.

Perintah `query`, `explain`, `path --directed`, dan `affected --relation blocked_by` telah dicoba. Reverse traversal #108 menghasilkan #109, #110, #114 dan #115. `path` umum dapat melewati edge referensi; untuk dampak blocker gunakan filter `blocked_by`. Graph ini belum mencakup AST kode aplikasi dan bukan bukti pengujian fitur baru.

`HOWTO.md` menjelaskan penggunaan lewat agen dan terminal. `tools/sync_sources.py` menyegarkan snapshot melalui `gh`, lalu update semantik tetap dijalankan melalui skill agen. Helper diuji dua kali dengan fixture snapshot API untuk memastikan file identik tidak ditulis ulang; hash sumber pada instalasi final juga cocok. Tidak ada scheduler otomatis.

Semua relasi sebelum proyeksi disimpan dalam `all-relations.json`; `graph.json` adalah DiGraph yang dapat melipat beberapa relasi pada pasangan node sama. Relasi native diprioritaskan dan diperiksa satu per satu. Penggunaan token ekstraksi model sesi tidak tersedia; angka placeholder tidak dipresentasikan sebagai biaya nol. Benchmark bawaan adalah perkiraan konteks atas pertanyaan generik, bukan evaluasi kualitas jawaban proyek.
