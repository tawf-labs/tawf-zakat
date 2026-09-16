## Problem Statement

Amil dan donatur membutuhkan satu alur pilot yang menghubungkan kontribusi dengan kegiatan, penyaluran uang/sembako, konfirmasi penerima, bukti distribusi dan sumber laporan. Fondasi pengajuan pada #86 sudah dikerjakan melalui #87–#91, sedangkan #92–#99 belum selesai. Riset diagram menambah kebutuhan penelusuran dan NFT; pengguna juga menetapkan ZK nyata sebagai nilai jual berprioritas tinggi. Jalur verifikasi donatur yang masih dapat menampilkan sukses simulasi belum memenuhi kebutuhan tersebut.

Memulai aplikasi baru atau menganggap semua tiket lama belum selesai akan menggandakan pekerjaan. Memasukkan NFT tanpa alokasi, sumber sah, privasi dan koreksi akan menghasilkan sertifikat yang tidak menjelaskan dasar klaim. Pilot harus berguna untuk donatur sekaligus amil, dengan batas antara catatan penerimaan, penyerahan fisik, proof dan pengesahan laporan yang jelas.

## Solution

Perluas fondasi yang sudah selesai menjadi satu pilot lembaga: satu Kegiatan penyaluran mengikuti satu Pengajuan penyaluran dalam Program bantuan. Lembaga menerima/membayar dana melalui prosesnya, petugas mencatat realisasi IDR/barang dan konfirmasi, lalu data yang sama menyuplai penelusuran donatur serta laporan periode. Donatur membuka satu kontribusi melalui OTP tanpa pendaftaran atau wallet wajib.

Dua keluaran teknologi wajib: (1) ZK keanggotaan kontribusi dalam batch penerimaan yang dicocokkan dan disahkan, dengan verifikasi smart contract nyata serta hasil persisten per versi receipt; (2) NFT untuk satu versi sertifikat tahap distribusi, dipegang lembaga, tidak diperdagangkan atau dipindahkan bebas, dengan riwayat koreksi. Keduanya memakai layanan berwenang dan anggaran layanan/pilot terpisah. Dana, konfirmasi, pertanggungjawaban dan publikasi mempunyai status masing-masing.

Spec ini adalah kelanjutan terpadu #86, bukan pembukaan ulang #87–#91. Nomor US pada spec ini berdiri sendiri; US-01–US-60 milik #86 tetap menunjuk baseline aslinya. Pilihan produk Q1–Q40 dan konfirmasi penutup telah diterima pada 2026-09-16.

## User Stories

1. As a Pengelola Zakat, I want to run one pilot Kegiatan penyaluran within my institution, so that donor traceability and amil reporting describe the same activity.
2. As an Amil operasional, I want to reuse completed account, source-import, program, mandate and examination features, so that completed work is preserved.
3. As an Amil operasional, I want to link the pilot activity to one approved Pengajuan penyaluran in a Program bantuan, so that there is one operational approval workflow.
4. As a Penyelenggara kegiatan, I want to work under an institutional assignment, so that responsibility is attributable to the institution.
5. As an Amil operasional, I want to record funds already received outside ZKT with their source references, so that the pilot does not require a new fundraising platform.
6. As a Pengelola Zakat, I want to execute payments through institutional channels, so that ZKT records evidence without taking custody.
7. As an Amil operasional, I want to keep payment recipients separate from beneficiaries, so that supplier payments do not pretend to be recipient handovers.
8. As an Amil operasional, I want to import beneficiary lists with stable identities, guardians and money or goods lines, so that bulk entry uses the same model as manual entry.
9. As an Amil operasional, I want to retain every invalid import row with its error and partial-total warning, so that no beneficiary disappears silently.
10. As an Amil operasional, I want to save incomplete imports privately and preview subsequent changes, so that corrections remain reviewable.
11. As a Pemeriksa pengajuan, I want to review alternative identity and representation evidence, so that people without their own phone or identity document are not replaced by fictitious records.
12. As a Pemberi persetujuan penyaluran, I want to endorse the exact reviewed proposal version within my mandate, so that approved rights have an attributable basis.
13. As a Pemberi persetujuan penyaluran, I want to be prevented from approving a version I materially prepared through another account, so that separation of duties follows the person.
14. As an Amil operasional, I want to record exact partial IDR disbursements against approved rights, so that remaining aid is accurate.
15. As an Amil operasional, I want to record exact goods quantities in declared units, so that packages, kilograms and rupiah are not added together.
16. As a Petugas lapangan, I want to capture a handover from a phone with explicit saved or unknown status, so that connection failure does not create a false success.
17. As a Petugas lapangan, I want to retry the same operation after a lost response, so that a handover is not counted twice.
18. As a Penerima bantuan, I want to know the aid type and quantity associated with a confirmation, so that my code is bound to a specific handover.
19. As a Perwakilan penerima, I want to confirm on a recorded and examined representation basis, so that my confirmation is not confused with another beneficiary.
20. As a Petugas lapangan, I want to use recipient OTP when the associated contact is available, so that confirmation remains separate from my own entry.
21. As a Petugas lapangan, I want to use a signed receipt or BAST fallback checked by another officer, so that lack of a phone does not invent OTP verification.
22. As an Amil operasional, I want to show incomplete confirmation separately from recorded disbursement, so that an incomplete record is not declared complete or counted again.
23. As an Amil operasional, I want to link group evidence to explicit recipient allocations, so that a group BAST remains traceable.
24. As a Penerima bantuan, I want to raise a concrete disagreement about receipt or quantity, so that prior OTP or BAST does not eliminate the right to report an error.
25. As a Pemeriksa pengajuan, I want to distinguish missing documents from disputed receipt, so that an incomplete file does not automatically accuse anyone of fraud.
26. As a Pengelola Zakat, I want to record dispute review and resolution without erasing prior evidence, so that the basis of a corrected claim remains visible.
27. As an Amil operasional, I want to record relevant expense amount, purpose, payee and source documents, so that activity costs can be reconciled.
28. As an Amil operasional, I want to distinguish officer advances, actual expenses and recipient handovers, so that money advanced is not counted as aid already received.
29. As an Amil operasional, I want to keep planned prices separate from actual costs, so that price differences remain visible.
30. As an Amil operasional, I want to show a goods valuation only with its basis and source, so that an unknown value is not presented as zero rupiah.
31. As a Pengelola Zakat, I want to retain outstanding expense accountability, so that an activity cannot hide unaccounted funds behind a completed handover.
32. As an Amil operasional, I want to record a Kontribusi donatur with fund type, purpose, source and reconciliation state, so that received funds are distinguishable from unexamined imports.
33. As an Amil operasional, I want to detect duplicated source contributions and retries, so that one payment does not create multiple contributions.
34. As a Pihak berwenang lembaga, I want to endorse only source-reconciled received contributions for a Batch kontribusi, so that a proof does not endorse unexamined data.
35. As an Amil operasional, I want to allocate an explicit portion of a contribution to a Kegiatan penyaluran, so that pooled funding is traceable without a fictitious one-to-one donor link.
36. As an Amil operasional, I want to see unallocated balances and enforce available contribution limits, so that allocations do not silently overcount funds.
37. As a Pengelola Zakat, I want to retain fund purpose restrictions during allocation and reallocation, so that moving a record does not authorize an incompatible use.
38. As a Donatur, I want to see my contribution and the activity it funds, so that I understand what the tracing reference represents.
39. As a Donatur, I want to see pooled activity progress without another donor's identity, so that traceability respects other people's privacy.
40. As a Donatur, I want to see allocation changes with their reasons and history, so that my earlier contribution is not silently rewritten.
41. As a Pihak berwenang lembaga, I want to correct an erroneous contribution amount while preserving actual disbursements, so that the record can be made truthful even when a discrepancy results.
42. As an Amil operasional, I want to see an over-allocation discrepancy and block allocations that worsen it, so that a correction is not hidden by rejecting the truth.
43. As a Pihak berwenang lembaga, I want to approve reallocation only after checking expenditure and outstanding obligations, so that unhanded aid is not mistaken for freely available funding.
44. As an Amil operasional, I want to record a refund decision separately from its actual payment, so that a decision is not misrepresented as money returned.
45. As a Pengelola Zakat, I want to apply institutional fund-specific refund policy, so that ZKT does not grant an automatic cancellation right.
46. As a Donatur, I want to receive a minimal notification through an associated available contact, so that my private contribution details are not exposed in forwarded messages.
47. As a Donatur, I want to open one contribution after OTP verification without compulsory registration, so that access does not require an account or wallet.
48. As a Donatur, I want to continue within a bounded verified session, so that I do not need a new code on every page.
49. As a Donatur, I want to have access confined to the authorized contribution, so that a shared contact does not reveal an entire donation history.
50. As a Donatur, I want to recover access through an authorized officer with evidence and an audit trail, so that knowing a transaction reference alone cannot redirect my access.
51. As an Amil operasional, I want to retain contributions with absent or incorrect contacts, so that missing contact data does not erase financial history.
52. As a Public reader, I want to see approved aggregates without faces, identity numbers, contacts or private documents, so that public transparency preserves recipient privacy.
53. As a Donatur, I want to see a genuine institutional receipt while ZK publication is pending, so that proving failure does not deny a received contribution.
54. As a Donatur, I want to see explicit proof pending, failed, verified or superseded status, so that the application does not manufacture verification success.
55. As a Donatur, I want to verify membership of my receipt in an institution-endorsed batch, so that the proof relates to the intended contribution.
56. As a Public verifier, I want to verify a real ZK proof in a smart contract without seeing donor identity or amount, so that privacy and verifiability coexist.
57. As a Pengelola Zakat, I want to authorize the processor that handles private proving inputs, so that the actual prover trust boundary is explicit.
58. As a Public verifier, I want to reject an otherwise valid proof against an unauthorized batch root, so that mathematical validity does not substitute for institutional authority.
59. As a Public verifier, I want to reject a proof relabelled as another receipt or institution, so that the evidence is bound to its intended context.
60. As a Donatur, I want to recheck the same receipt without another paid publication transaction, so that verification is repeatable and does not create another donation.
61. As an Operator layanan, I want to persist successful ZK verification once per receipt version after confirmed execution, so that a broadcast hash is not called success.
62. As an Operator layanan, I want to retry publication within a separate authorized service budget, so that fund contributions are not automatically reduced for gas.
63. As a Pengelola Zakat, I want to retain corrected contribution batches and receipts as superseded history, so that a historically valid proof is not confused with the current record.
64. As a Public verifier, I want to see business validity separately from mathematical proof validity, so that a superseded root cannot masquerade as a current receipt.
65. As a Pihak berwenang lembaga, I want to endorse a frozen Sertifikat distribusi for a specific distribution stage, so that evidence can be published before the whole activity or reporting period ends.
66. As a Donatur, I want to inspect the certificate issuer, content binding and current status, so that I can distinguish an authentic record from a copied image.
67. As a Pengelola Zakat, I want to hold the NFT distribusi in the institutional account, so that donors are not forced to own wallets.
68. As a Donatur, I want to reference the same distribution certificate as other activity funders, so that the same handover is not duplicated into new aid.
69. As a Pengelola Zakat, I want to prevent unrestricted transfers and trading of the distribution NFT, so that token ownership is not treated as a marketable aid entitlement.
70. As a Pengelola Zakat, I want to recover institutional account access through authorized traceable actions, so that recovery does not silently alter the certificate or issuer.
71. As a Public verifier, I want to inspect one fixed certificate version per NFT, so that a token cannot silently change the historical statement it represents.
72. As a Pihak berwenang lembaga, I want to issue a new NFT version for a corrected certificate and mark the predecessor, so that history remains available without presenting obsolete evidence as current.
73. As a Donatur, I want to see a dispute affecting an already issued certificate, so that a previously minted token does not hide a later disagreement.
74. As an Operator layanan, I want to mint only after institutional endorsement and confirmed transaction success, so that publication states remain truthful.
75. As an Operator layanan, I want to recover an interrupted mint without creating another official token for the same version, so that retries do not duplicate certificates.
76. As a Donatur, I want to see NFT pending or failed separately from physical distribution progress, so that a failed mint does not falsify whether aid was handed over.
77. As a Public reader, I want to see only approved aggregate NFT metadata, so that the public token is not a route to restricted evidence.
78. As an Amil operasional, I want to reuse actual disbursement records as reporting sources, so that I do not enter a second donor-facing ledger.
79. As an Amil operasional, I want to freeze source provenance at a defined period and cut-off, so that later edits do not change an earlier report.
80. As a Pembaca berwenang, I want to trace report amounts to the correct proposal, realization and evidence versions, so that a claim can be examined from its sources.
81. As an Amil operasional, I want to distinguish reporting sources that are empty, missing or failed, so that unavailable evidence is not converted to zero.
82. As an Amil operasional, I want to retain external institutional source imports without invented beneficiary detail, so that partial source detail is represented honestly.
83. As an Auditor Independen, I want to record findings against a specific report version and inspect relevant distribution evidence, so that the audit scope is explicit.
84. As an Amil operasional, I want to respond to findings with attributable private evidence, so that the auditor can follow up without overwriting a report.
85. As an Auditor Independen, I want to determine follow-up separately from operational approval, so that audit findings do not authorize payments or rewrite transactions.
86. As a Donatur, I want to see distribution, funding accountability, confirmation and evidence-publication statuses separately, so that one green status does not conceal unfinished work.
87. As an Amil operasional, I want to revise approved recipients or rights with reasons and renewed approval, so that changes preserve prior decisions and actuals.
88. As a Pengelola Zakat, I want to close undistributed aid explicitly without counting it as received, so that closed remainders do not become fictitious realization.
89. As a Pengguna aplikasi, I want to receive clear errors and accessible controls on laptop and phone, so that I can complete the workflow without relying on color alone.
90. As a Pemelihara proyek, I want to preserve completed #87–#91 and exact legacy USDC behavior, so that the new pilot does not reopen completed work or reinterpret old amounts.
91. As a Pemelihara proyek, I want to test the workflow through authenticated application HTTP with real isolated storage, so that tests prove externally observable behavior.
92. As a Pemelihara proyek, I want to produce real proofs and execute generated verifiers and NFT contracts in local EVM tests, so that a mocked success cannot satisfy the cryptographic requirement.
93. As an Operator pilot, I want to verify the deployed application and API at actual pilot URLs, so that local test success is not confused with a usable pilot.
94. As an Operator pilot, I want to validate provider configuration, storage recovery, signing authority and publication budgets, so that the pilot has known operational ownership.
95. As a Pengelola Zakat, I want to supply real SOP, report examples, field conditions and volume before rollout, so that readiness is assessed against the intended institution.
96. As a Pemelihara proyek, I want to retain a clear map from old issues to completed work or successor acceptance criteria, so that closing old issues does not discard unresolved requirements.

## Implementation Decisions

1. **Kelanjutan dan pemilik fakta.** Pertahankan implementasi #87–#91 sebagai selesai. Pengelolaan penyaluran tetap memiliki program, pengajuan/versi, penerima, rincian hak, keputusan, realisasi, revisi dan penutupan sisa. Kontribusi/alokasi, konfirmasi, batch kontribusi dan sertifikat tahap merujuk identitas tersebut. Tidak ada ledger realisasi kedua untuk tampilan donatur atau NFT.
2. **Reuse batas yang ada.** Gunakan akses ruang kerja terikat konteks, identitas operator/mandat, pembaca tabular, Dokumen terbatas, SQL, snapshot, rekonsiliasi deterministik, versi laporan dan lifecycle registry yang sudah tersedia. Konteks operator berbeda dari akun pengesah/pemegang NFT. Jangan membuat autentikasi, database, parser atau mesin workflow generik baru untuk setiap layar.
3. **Kontrak operasi.** Operasi aplikasi mencakup pencatatan dan pencocokan kontribusi, pengesahan batch, alokasi/perubahan, realisasi/konfirmasi, pemeriksaan sengketa, persiapan/pengesahan sertifikat, penerbitan bukti dan pembacaan status. Setiap mutasi memakai konteks lembaga dari sesi, identitas operasi idempoten, versi yang diharapkan, otorisasi saat tindakan dan hasil durable. Konflik ditolak tanpa menimpa pemenang. Ketidakpastian jaringan tidak dilabeli gagal pasti atau sukses.
4. **Model data aditif.** Simpan asal penerimaan/identitas sumber, nominal/satuan eksak, jenis dana, peruntukan, status pencocokan/pengesahan, kontak terbatas, riwayat alokasi, biaya/uang muka, realisasi/konfirmasi, sengketa dan penyelesaiannya, versi batch/receipt, sertifikat tahap/NFT dan percobaan publikasi. Relasi identitas, versi, waktu kejadian/pencatatan/publikasi dan provenance harus eksplisit. Constraint atomik menjaga uniqueness, batas hak, batas alokasi dan satu penerus resmi. Jangan menganggap satu kontak sebagai satu identitas global.
5. **Kontribusi dan pendanaan gabungan.** Impor saja tidak membuat dana diterima atau batch sah. Sumber lembaga dicocokkan dan disahkan pihak berwenang. Alokasi nominal tidak melebihi kontribusi tersedia; sisa terlihat. Penelusuran awal ke tingkat kegiatan, bukan klaim paket tertentu milik donor tertentu. Tidak ada gerbang baru bahwa semua realisasi historis harus mempunyai atribusi donor lengkap; cakupan detail yang tersedia dinyatakan.
6. **Alokasi/koreksi/refund.** Koreksi nominal yang benar tidak ditolak hanya karena menimbulkan selisih: pertahankan actuals, tampilkan selisih dan hentikan tambahan yang memperburuknya. Reallocation memerlukan keputusan dan alasan, memeriksa biaya/kewajiban serta peruntukan, dan menyisakan riwayat yang terlihat donatur. Keputusan refund dipisahkan dari pembayaran pengembalian oleh lembaga. Koreksi data, pembatalan pengajuan dan pengembalian uang tidak disamakan.
7. **Hak dan realisasi.** Rincian bantuan mengikuti versi pengajuan yang disahkan, larangan menyetujui sendiri tetap berlaku lintas akun orang yang sama. IDR dan kuantitas barang memakai angka eksak; unit berbeda tidak dijumlahkan. Realisasi belum lengkap buktinya tetap mengurangi sisa hak untuk mencegah penggandaan. Revisi hak tidak menimpa realisasi. Pembayaran penyedia dan uang muka petugas tidak otomatis membuktikan bantuan diterima mustahik.
8. **Biaya dan valuasi.** Catat nominal, tujuan, pihak penerima pembayaran dan referensi dokumen biaya. Pisahkan rencana, aktual, uang muka dan pertanggungjawaban. Penyerahan barang mempertahankan jumlah/satuan; nilai IDR hanya dengan sumber/dasar kebijakan lembaga. Pengadaan dan penyerahan bukan dua nilai bantuan untuk dijumlahkan. Tidak membangun inventori atau akuntansi lengkap.
9. **Konfirmasi dan sengketa.** Catatan petugas berbeda dari pernyataan penerima/perwakilan. OTP terikat kejadian, versi, jenis/jumlah dan kontak yang sesuai; tidak dapat dipakai ulang untuk penerima/kejadian lain. Alternatif tanda terima/BAST diperiksa petugas lain. Perubahan materi membatalkan konfirmasi lama untuk materi baru tanpa menghapus riwayat. Kekurangan dokumen berbeda dari pertentangan konkret atas penerimaan. Sengketa menahan klaim konfirmasi final terkait, mempertahankan bukti dan ditindaklanjuti lembaga; temuan auditor tidak mengubah transaksi otomatis.
10. **Akses donatur.** Notifikasi membawa informasi minimum dan akses progres umum. Detail privat memerlukan OTP ke kontak terkait, sesi terbatas dan otorisasi objek di setiap permintaan. Terapkan kedaluwarsa, pemakaian sekali, pembatasan percobaan/pengiriman dan pencabutan akses; OTP/token tidak dicatat di log publik. Kontak kosong tetap mempertahankan kontribusi. Pemulihan kontak memerlukan petugas berwenang serta dasar hubungan ke kontribusi, bukan nomor referensi saja. Akun seluruh riwayat tetap perluasan opsional.
11. **Privasi.** Proyeksi publik memakai allowlist agregat; identitas/nominal donor tidak terbuka melalui proof, metadata NFT, calldata atau log. Identitas, kontak, foto wajah, rekening, lokasi rinci yang mengidentifikasi penerima dan dokumen lengkap tetap terbatas. Kontrol akses dilakukan sebelum membaca berkas; dokumen diverifikasi terhadap commitment sumber yang sah. Bukan sekadar menyembunyikan tombol atau menghilangkan nama dari foto.
12. **ZK statement dan kewenangan root.** Proof membuktikan keterkaitan receipt tertentu dengan catatan dalam batch penerimaan lembaga yang sah; public inputs mengikat konteks lembaga, batch/versi, receipt/versi dan tujuan verifikasi. Identitas, nominal dan witness membership privat terhadap publik; lembaga/prosesor berwenang boleh mengolahnya. Salt/commitment harus mencegah tebakan dari data berentropi rendah. Root buatan penyerang ditolak meski proof valid secara matematis. Proof membership bukan bukti bank, seluruh kelengkapan penerimaan, eligibilitas zakat atau penyerahan fisik.
13. **Pipeline ZK nyata.** Circuit arsip dan angka benchmark paper tidak dianggap circuit pilot. Pilih serta pin pasangan versi compiler/prover/verifier setelah spike reproduktif menghasilkan proof, verifikasi Solidity, ukuran deployment dan gas pada target EVM. Catat statement, public inputs, trust/setup dan artefak kunci/circuit yang cocok. Tidak ada fallback yang menerima semua proof, anchor hash pengganti verifier atau penggunaan Merkle biasa sebagai label ZK. Pilihan library/versi/jaringan belum diputuskan oleh brainstorming.
14. **Publikasi dan koreksi kontribusi.** Hasil verifikasi nyata dicatat sekali per receipt version melalui transaksi; pembacaan ulang tidak memerlukan transaksi baru atau spent-nullifier yang melarang pemeriksaan sah. Ada pemisahan pending/failed/confirmed, mathematical validity dan business currentness. Koreksi batch/receipt mempertahankan sejarah dan hubungan pengganti. Spec teknis wajib menetapkan dampak terhadap receipt tak berubah dan transisi root tanpa membuat semua proof lama tampak terkini atau menerbitkan ganda.
15. **NFT tahap distribusi.** Satu sertifikat versi membekukan cakupan tahap, sumber realisasi/konfirmasi, pengesah dan commitment bukti; akun lembaga memegang satu NFT resmi untuk versi tersebut. Penerbitan dapat mendahului laporan periode dan akhir kegiatan. Beberapa donor merujuk sertifikat sama tanpa menggandakan bantuan. Token tidak diperdagangkan/dipindahkan bebas; kepemilikan tidak memberi hak bantuan atau akses privat. Koreksi menerbitkan versi/token baru, mempertahankan token historis dan tautan pengganti. Status sengketa/keberlakuan diperiksa terpisah dari isi tetap.
16. **Standar NFT dan recovery.** Pilih standar setelah menegakkan pemegang institusi, kebijakan transfer, isi tetap, versioning dan kompatibilitas verifier. Rancang pemulihan akun/rotasi atau penerbitan pengganti berotorisasi dan berjejak; jangan menyisipkan transfer admin tersembunyi. Pilihan mekanisme harus memenuhi riwayat yang dipertahankan, tidak mengubah penerbit historis atau membuka dokumen privat. Metadata publik dan penyimpanan privat terpisah; gambar wallet bukan otoritas status.
17. **Operasi publikasi.** Layanan berwenang menjalankan proving/pengiriman/mint setelah pengesahan dan dalam batas anggaran layanan/pilot terpisah. Simpan identitas percobaan, material pengesahan, receipt dan pengamatan chain agar restart/broadcast ambigu/retry tidak membuat receipt atau NFT resmi ganda. Keberhasilan baru setelah transaksi sukses memenuhi konfirmasi; RPC gagal/reorg tidak mempertahankan badge sukses palsu. Anggaran tidak otomatis memotong kontribusi dan donatur tidak diwajibkan membayar gas. Sumber fisik tetap tercatat saat publikasi gagal.
18. **Pelaporan dan pemeriksaan.** Adapter realisasi membekukan sumber, cakupan/periode/cut-off dan provenance yang sama untuk laporan. Laporan periode tetap memakai registry terpisah dengan dua pengesahan dan atestasi auditor per versi; sertifikat tahap tidak mengganti gerbang itu. Pengesahan institusi, hasil validator, konfirmasi penerima, ZK dan NFT tampil sebagai klaim berbeda. Audit findings/responses tetap privat sesuai mandat; koreksi laporan tidak mewarisi opini lama.
19. **UX/status.** Pisahkan progres hak/penyaluran, pertanggungjawaban dana, kelengkapan/konfirmasi/sengketa dan status publikasi ZK/NFT. Tidak ada satu badge sukses statis, data fallback untuk ID tidak ditemukan, atau klaim selesai dari klik/hash. Gunakan bahasa operasional, keyboard/fokus/error per field/baris dan layout ponsel. Alur lapangan memerlukan koneksi untuk simpan; dokumen lapangan dapat dicatat setelahnya tanpa janji cache PII offline.
20. **Pengelolaan pekerjaan dan rollout.** #86 tetap parent operasional untuk #92–#99, dengan amandemen mengarah ke spec ini. Nomor dan dependensi pekerjaan belum selesai dipertahankan; perubahan kontrak integrasi dijelaskan pada masing-masing tiket. Fitur baru tidak dianggap selesai oleh penutupan tiket lama. Migrasi aditif/backfill memerlukan sumber yang dapat dibuktikan dan rencana rollback; deployment tidak otomatis menjalankan migrasi. Hak akses layanan, jaringan/target deployment, kapasitas, biaya, provider OTP dan SOP mitra harus nyata sebelum penggunaan pilot.

## Testing Decisions

**Disepakati pengguna pada sesi to-spec:** HTTP aplikasi sebagai batas utama, dengan database dan penyimpanan privat nyata, integrasi lokal yang benar-benar menghasilkan dan memverifikasi ZK serta NFT di EVM, dan smoke browser alur penting. Hanya layanan luar seperti pengiriman OTP yang diganti fixture. Jawaban pengguna: “Setuju dengan batas pengujian ini.”

- Tes menilai respons, otorisasi, state yang dapat dibaca ulang, angka, akses berkas, hasil chain dan riwayat setelah retry/restart. Jangan mengunci struktur helper, hitungan pemanggilan internal atau snapshot UI yang hanya menyalin implementasi.
- Gunakan Hono HTTP, challenge/session dan signature uji nyata, PGlite/SQL terisolasi, filesystem terenkripsi sementara, aturan domain/pencocokan/penghitungan nyata. Kendalikan waktu/transport eksternal untuk expiry dan kegagalan. Jangan memalsukan verifier, otorisasi, hasil bank atau angka yang sedang dibuktikan.
- Modul yang diuji melalui alur: pengajuan/realisasi/revisi, kontribusi/alokasi/biaya, konfirmasi/sengketa, akses donatur, batch/prover/publikasi ZK, sertifikat/NFT, adapter sumber laporan dan tindak lanjut auditor. Pertahankan tes publik parser, angka eksak, akses frontend dan kontrak jika invariant itu disentuh; tidak membuat seam baru per helper.
- Prior art repo: suite API pengajuan memakai login asli dan SQL dengan reread/restart; suite evidence memakai snapshot dan berkas terenkripsi; suite registry memakai signature, SQL, Anvil, receipt, reorg dan browser; suite deposit/proposal mempertahankan jumlah eksak serta warisan belum terverifikasi. Perluas harness lokal tersebut untuk verifier ZK yang benar-benar dihasilkan dan NFT nyata.
- Gunakan dua lembaga sintetis, beberapa petugas dan akun yang mewakili orang sama, akun institusi, auditor dan donor berbeda, barang/mata uang eksplisit serta berkas buatan. Jangan gunakan kontak penerima nyata, bank live, pinning dokumen publik atau pembayaran mainnet untuk tes otomatis.

### Skenario penerimaan wajib

| ID | Skenario dan hasil yang harus terbukti |
| --- | --- |
| AC01 | Alur pengajuan uang/barang memakai fondasi #87–#91; pembacaan ulang mempertahankan operator, lembaga dan sumber yang benar. |
| AC02 | Impor seratus baris/tujuh error, duplikasi dan unggah ulang menjaga seluruh baris, identitas, unit, angka eksak dan konflik versi. |
| AC03 | Pengesahan sendiri melalui akun lain, mandat usang/revoked, replay dan signature salah konteks ditolak; keputusan tidak mengirim dana. |
| AC04 | Realisasi 80 dari 100, dua petugas serentak, respons hilang dan restart tidak melampaui hak atau menggandakan kejadian. |
| AC05 | OTP terikat jenis/jumlah/kejadian; salah, expired, replay dan kontak/kejadian lain ditolak. BAST fallback diperiksa petugas lain dan metodenya terlihat. |
| AC06 | Bukti belum lengkap tetap terlihat dan mengurangi sisa hak; foto saja tidak menghasilkan konfirmasi final. |
| AC07 | Uang muka, pembelian paket dan penyerahan paket tidak dijumlahkan sebagai bantuan ganda; sisa pertanggungjawaban dan dasar valuasi terbaca. |
| AC08 | Kontribusi impor belum diperiksa tidak masuk batch sah; pengulangan sumber tidak menciptakan dana baru. |
| AC09 | Alokasi gabungan/parsial menjaga jenis dana, peruntukan dan limit atomik; sumber tanpa detail donor tidak diberi hubungan fiktif. |
| AC10 | Koreksi 500.000 menjadi 400.000 dengan alokasi 450.000 menghasilkan selisih 50.000, mempertahankan realisasi dan memblokir tambahan yang memperburuk. |
| AC11 | Pengalihan memeriksa biaya/kewajiban dan menyimpan alasan; penutupan sisa hak tidak otomatis merealokasi atau refund. |
| AC12 | Keputusan refund dan pembayaran actual berbeda; koreksi data ganda tanpa pembayaran balik tidak menjadi refund. |
| AC13 | Forward tautan, tebakan ID dan mengganti ID kontribusi tidak membuka detail privat; sesi satu kontribusi tidak membuka semua riwayat kontak bersama. |
| AC14 | OTP donor salah/expired/berulang/rate-limited ditolak; pemulihan kontak memerlukan pemeriksaan dan mencabut akses lama bila perlu. |
| AC15 | Publik/NFT/calldata/log tidak memuat donor identity/amount atau identitas/foto/kontak/dokumen privat penerima; hash tidak dijadikan alasan membuka data mentah. |
| AC16 | Pipeline membuat proof nyata untuk receipt sah dan generated Solidity verifier menerima di EVM lokal; modifikasi witness/proof/public input yang tidak sah ditolak. |
| AC17 | Proof valid matematis pada root tidak berwenang, receipt lain, lembaga lain atau konteks salah ditolak pada batas aplikasi/kontrak. |
| AC18 | Receipt yang sama dapat diperiksa ulang, sementara retry publikasi hanya menghasilkan satu hasil resmi per versi dan tidak menciptakan kontribusi baru. |
| AC19 | Koreksi batch/receipt menjaga sejarah, status current/superseded dan kebijakan receipt tak berubah yang eksplisit; proof historis tidak mendapat badge current. |
| AC20 | Proving/submit/RPC gagal, anggaran habis atau transaksi belum dikonfirmasi menampilkan keadaan jujur; pencatatan penerimaan tidak dibatalkan dan tidak ada proof buatan. |
| AC21 | Sertifikat tahap disahkan pejabat yang berwenang, lalu satu NFT versi resmi diterbitkan ke akun lembaga dari referensi realisasi yang benar; retry/restart tidak menggandakannya. |
| AC22 | Transfer bebas/perdagangan ditolak; pemulihan berwenang diuji sesuai mekanisme terpilih dan pemulihan palsu ditolak, dengan issuer/content/history tetap terlacak. |
| AC23 | NFT versi koreksi menaut pendahulu, isi versi lama tetap, dan verifier membedakan issuer palsu, metadata diubah, token historis dan versi resmi terkini. |
| AC24 | Sengketa setelah mint mengubah status klaim terkait tanpa menghapus realisasi/riwayat; dokumen kurang saja tidak otomatis menghasilkan tuduhan sengketa. |
| AC25 | Mint gagal/tertunda/reorg tidak menyatakan NFT terbit atau seluruh kegiatan gagal; status dana, penyaluran, konfirmasi, ZK dan NFT tetap terpisah. |
| AC26 | Pembekuan sumber realisasi menjaga cut-off, barang tanpa valuasi dan provenance; revisi aktif tidak mengubah snapshot/atestasi lama. |
| AC27 | Sumber kosong, hilang, rusak dan gagal berbeda; proyeksi publik tidak membuka locator/salt/berkas; laporan tetap memerlukan dua pengesahan. |
| AC28 | Auditor menulis temuan per versi, amil menanggapi, auditor menindaklanjuti; amil tidak dapat menutup temuan atas nama auditor atau mengubah snapshot. |
| AC29 | Isolasi lembaga, logout/expiry/revocation, respons akun lama terlambat dan akses dokumen diuji melalui pemilik sesi sebenarnya. |
| AC30 | Smoke browser laptop/ponsel menunjukkan donor OTP, petugas realisasi/konfirmasi, amil sumber laporan, pengesah sertifikat dan pemeriksa status/koreksi; label status/error/keyboard berfungsi. |
| AC31 | Jalur USDC historis tetap memakai jumlah native dan identitas event/proposal yang eksak; tidak mendapat konversi IDR, pengajuan atau penerima rekaan. |
| AC32 | Verifikasi rilis dilakukan pada URL aplikasi/API pilot yang sebenarnya: ruang kerja, rekonsiliasi, laporan, penelusuran kontribusi, ZK dan NFT dapat dipakai. LPZN golden case menghasilkan selisih 668.020.210.274 dan draf angka salah ditolak validator. Server secret tidak masuk browser; provider/pengesah/storage/budget terkonfigurasi. |
| AC33 | Paket rilis mencatat target jaringan/deployment, versi artefak/prover/verifier, ukuran/gas terukur, konfigurasi konfirmasi, hasil pengujian, backup/recovery serta prosedur migrasi/rollback yang benar untuk skema baru. Klaim lama deployment tanpa migrasi dari #66 tidak dibawa sebagai asumsi. |
| AC34 | Data/SOP mitra, mandat, kanal, volume, koneksi, output laporan dan anggaran dikonfirmasi sebelum digunakan; data uji tidak disajikan sebagai pilot nyata. |

Kriteria di atas adalah kewajiban implementasi, bukan hasil pengujian yang sudah dijalankan pada sesi penulisan spec ini.

## Out of Scope

- Membuka ulang #87–#91 atau menghapus kemampuan selesai hanya karena prioritas berubah.
- Marketplace penyelenggara independen, penebusan merchant, kewajiban penggalangan baru, custody/escrow/payout otomatis dan transfer bank oleh ZKT.
- NFT sebagai hak menebus, perdagangan token, NFT wajib per donor/per penerima, atau kewajiban wallet donor. NFT distribusi tahap dan ZK kontribusi tetap IN scope.
- Foto wajah, KTP, kontak, identitas donor/nominal privat atau dokumen penerima di metadata publik; akses semua riwayat melalui kontak yang sama.
- Privasi witness terhadap lembaga/prosesor yang diberi kewenangan; ZK eligibilitas zakat, kebenaran bank/penyerahan fisik, kelengkapan seluruh ledger atau ZK aritmetika laporan sebagai klaim otomatis.
- Sistem pengadaan/inventori/akuntansi penuh, valuasi barang atau hak refund universal yang ditentukan aplikasi, integrasi SiMBA tanpa format/akses mitra nyata.
- Aplikasi lapangan sepenuhnya offline, GPS wajib, QR/TOTP sebagai pengganti otomatis keputusan OTP/BAST, dan akun riwayat donor sebagai syarat.
- Menjalankan migrasi, deploy, transaksi publik atau mengirim pesan ke donor/mitra dalam sesi penerbitan spec ini. Implementasi dan rollout mengikuti pekerjaan tersendiri.

## Further Notes

- Konfirmasi pemahaman bersama sudah diterima. Pengguna meminta menutup issue lama, memperlakukan pekerjaan selesai sebagai selesai, serta menyesuaikan kelanjutan #86. Batas pengujian to-spec juga sudah dikonfirmasi; tidak ada wawancara produk baru yang diperlukan untuk menerbitkan spec ini.
- Dasar domain: ADR-0026–0030 tetap fondasi operasional; ADR-0031–0033 mengatur pilot/alokasi/akses/konfirmasi; ADR-0034 mewajibkan ZK membership onchain; ADR-0035 mewajibkan NFT distribusi dan Q37–Q40. Ringkasan keputusan disertakan dalam spec agar issue dapat dibaca tanpa mengandalkan dokumen lokal yang belum dipush.
- #87–#91 tetap CLOSED. #92–#99 tetap OPEN dengan kriteria lama dipertahankan serta amandemen pilot; #86 tetap mengelola pekerjaan operasional tersebut. Spec ini memiliki kebutuhan baru ZK/NFT/kontribusi/akses yang belum menjadi tiket implementasi tersendiri; publikasi spec tidak menganggapnya sudah dikerjakan.
- Penutupan issue lama berbasis commit/dokumen atau pemindahan cakupan, bukan umur saja. #55, #61, #67, #68, #80, #81 dan #82–#85 mempunyai implementasi/fondasi tersimpan; verifikasi deployment lama dipindahkan dari #66 ke AC32–AC34. #66 ditutup sebagai superseded/not planned, bukan klaim telah deploy. Bukti penutupan dicatat pada masing-masing issue.
- Tidak ada pemilihan toolchain/standar NFT/target jaringan secara diam-diam. Spike teknis harus menghasilkan artefak yang dapat direproduksi, bukti verifikasi EVM nyata dan batas operasional sebelum alur disebut siap. Bila hasil menuntut perubahan klaim, privasi atau cakupan wajib, buka kembali keputusan secara eksplisit.
- Pertahankan dependensi native #92←#88/#89, #93←#91, #94←#93, #95←#94, #96←#94, #97←#92/#96, #98←#95/#96, #99←#98. Integrasi baru memakai kontrak/provenance yang dinyatakan pada amandemen dan diperinci saat pemecahan pekerjaan baru; jangan menutup tiket atas implementasi sebagian.
