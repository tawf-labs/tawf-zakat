# ADR-0036: Pemulihan pemegang sertifikat melalui penerbitan pengganti

- Status: Accepted — memilih mekanisme yang ditunda ADR-0035/Q38, untuk #113.
- Related: ADR-0035, ADR-0006, ADR-0023.

## Keputusan

Token sertifikat tetap terkunci (ERC-5192) dan **tidak pernah dipindahkan**, oleh siapa pun.
Bila pengendali institusi berubah, token resmi diganti dengan token baru yang diterbitkan ke
pengendali tersebut. Mekanisme rotasi/transfer admin ditolak karena menambah pintu pemindahan
yang tersembunyi (larangan Q38).

- Pengendali baru adalah **pengendali terselesaikan** pada kontrak: yang ditetapkan
  administrator institusi lewat `setCustodian`, atau administrator registry bila belum ada
  penetapan (termasuk setelah rotasi administrator melalui `proposeAdministrator`/`acceptAdministrator`).
  Layanan dan operator tidak dapat memilih alamat tujuan.
- Penetapan pengendali (administrator) dan pengesahan pemulihan (penandatangan aktif) adalah
  dua otorisasi terpisah. API memerlukan mandat operasional tersendiri
  `RECOVER_CERTIFICATE_CUSTODY` dan dasar keputusan lembaga (hash-nya terikat pada tanda tangan).
- `recoverCustody` menerbitkan token baru dengan **penerbit asli, komitmen isi, kegiatan dan versi
  yang sama**. Token lama tetap terbaca di pemegang lama, ditandai `custodyReplacedBy`. Hanya versi
  resmi terkini yang dapat dipulihkan; versi yang sudah digantikan koreksi tetap sebagai riwayat.
- Pengesahan pemulihan memakai action dan tipe EIP-712 sendiri, sehingga pengesahan penerbitan
  tidak dapat diputar ulang sebagai pemulihan (dan sebaliknya). Nonce berbagi ruang dengan penerbitan.
- Pengesahan mengikat `previousTokenId`, `custodyEpoch` dan `administratorEpoch`, selain epoch
  mandat penandatangan. Setiap `setCustodian` menaikkan epoch custody, termasuk penetapan ulang
  alamat yang sama. Epoch administrator dibaca dari registry. Kontrak menolak pengesahan lama
  setelah rotasi bolak-balik atau penggantian token asal, tanpa bergantung pada polling API.
- Pengesahan menjadi usang (dan ditandai `voided`, tidak pernah hidup lagi) bila epoch mandat,
  epoch custody/administrator, pengendali terselesaikan, versi resmi terkini, atau pemegang berubah.
  Invalidasi disimpan juga bila sudah ada transaksi tersimpan; hasil transaksi tetap diperiksa
  dari receipt kanonis sehingga invalidasi tidak menghapus riwayat eksekusi yang sudah sah.
- Pengesahan yang melewati deadline tidak digunakan kembali oleh persiapan baru. Operator
  meninjau dan menandatangani intent baru; transaksi/signature lama tidak ditimpa. Pemulihan
  berikutnya tetap tersedia ketika riwayat pemulihan sebelumnya sudah selesai.

## Batas

- Hilang/kompromi kunci **administrator** tidak dipulihkan di sini: registry sengaja tidak punya
  override admission. Prasyaratnya adalah administrator dapat menandatangani `setCustodian`
  atau `proposeAdministrator`; jika kunci itu hilang, penyelesaiannya ada pada tata kelola registry.
- Penetapan pengendali baru dilakukan di chain oleh administrator (dompet/Safe), bukan lewat UI ini.
