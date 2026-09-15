# ADR-0027: Program Menaungi Pengajuan dengan Daftar Penerima

- Status: Accepted — Q3–Q4 sesi `grill-with-docs`, 2026-09-15.
- Related: ADR-0026, ADR-0021.

Satu program bantuan dapat menaungi banyak pengajuan penyaluran; satu pengajuan dapat mencakup satu atau banyak penerima dengan rincian bantuannya masing-masing. Identitas penanggung jawab dicatat terpisah. Alur awal dimulai oleh amil internal yang mencatat permohonan yang diterima lembaga beserta asalnya; portal pemohon eksternal menjadi kemungkinan perluasan berikutnya.

Model ini dipilih agar kegiatan berulang dan penyaluran kepada banyak penerima dapat ditelusuri tanpa menyamakan program dengan satu orang. Alternatif mempertahankan satu penerima per proposal lalu menggandakan judul program akan memecah cakupan pengajuan dan mengaburkan hubungan antara rencana bantuan, daftar penerima, dan pemeriksaannya. Perubahan ini memengaruhi kepemilikan data dan integrasi; menambah baris pada form saja tidak memenuhi keputusan.

Q7–Q9 kemudian memilih bantuan uang/barang untuk penerima terdaftar, pemetaan persetujuan menurut SOP lembaga, dan realisasi bertahap melalui [ADR-0028](0028-institutional-approval-and-partial-realization.md). Q13/Q14 menetapkan daftar lengkap sebelum meminta persetujuan, dukungan dasar identitas/perwakilan yang ditelaah, serta peringatan bantuan berulang menurut program/periode. Revisi dan penutupan sisa ditetapkan [ADR-0029](0029-proposal-revisions-and-recorded-institutional-decisions.md). Skema data dan kebijakan rinci program tetap menjadi pekerjaan spesifikasi; akses dokumen terbatas mengikuti ADR-0021.

Lihat [catatan wawancara](../research/0005-pengajuan-penyaluran-dan-ux-grilling.md) dan istilah di [CONTEXT.md](../../CONTEXT.md).
