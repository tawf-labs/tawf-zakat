# ADR-0023: Akses Ruang Kerja adalah Protokol Offchain Tersendiri

- Status: Accepted — diputuskan saat implementasi tiket #69 (Spec #68).
- Date: 2026-09-08.
- Decider: implementasi tiket #69, mengikuti keputusan ADR-0020–0022 dan batas ADR-0019.
- Related: ADR-0019 (signing governance vault), ADR-0021 (pengesahan lembaga dan akses sumber terbatas), ADR-0022 (registry bukti terpisah).

Masuk ke **ruang kerja lembaga** memakai domain EIP-712 tersendiri, `Tawf Workspace Access`, **tanpa `verifyingContract`**. Identitas dibuktikan dengan tantangan sekali pakai yang diterbitkan server dan ditandatangani akun — EOA melalui pemulihan tanda tangan, akun kontrak melalui ERC-1271. Sesi yang dihasilkan adalah token bearer yang **hanya disebutkan sekali**, dan yang disimpan adalah SHA-256-nya, bukan tokennya.

Kewenangan pada ruang kerja hanya mengatur akses offchain. Ia **tidak pernah** menjadi cadangan bagi role rantai yang tidak sah: pencatatan bukti dan penerbitan laporan tetap diperiksa registry (ADR-0022).

## Mengapa domain terpisah

ADR-0019 menetapkan domain signing governance vault, yang menyebut `verifyingContract`. Bila akses ruang kerja memakai domain yang sama, satu tanda tangan masuk berpotensi ditafsirkan ulang sebagai tindakan governance terhadap kontrak itu. Nama domain yang berbeda menghasilkan domain separator yang berbeda, sehingga hal tersebut tidak mungkin terjadi. Ketiadaan `verifyingContract` juga menyatakan apa adanya bahwa yang diotorisasi bukan tindakan pada kontrak mana pun.

## Trade-off

- **Tantangan sekali pakai dibanding tanda tangan tanpa nonce:** memerlukan satu permintaan tambahan dan satu tabel, tetapi tanda tangan yang bocor tidak dapat diulang, dan masa berlakunya tertutup.
- **Verifikasi tanda tangan sebelum nonce dibelanjakan:** memerlukan satu pembacaan tambahan sebelum `UPDATE` bersyarat, tetapi orang yang mengetahui sebuah nonce tidak dapat membakarnya dengan sampah dan mengunci petugas yang sah dari tantangannya sendiri. Keunikan pemakaian tetap ditegakkan oleh `UPDATE` bersyarat, karena hanya itu yang atomik.
- **Token bearer dibanding tanda tangan pada setiap permintaan:** wallet tidak diminta menandatangani tiap klik, dengan konsekuensi ada kredensial yang harus dijaga. Karena itu token disimpan sebagai hash, dikembalikan sekali, memiliki masa berlaku, dan dapat dicabut; keanggotaan dibaca ulang pada setiap permintaan sehingga pencabutan berlaku tanpa menunggu kedaluwarsa.
- **Satu keanggotaan aktif per akun:** menyederhanakan penentuan lembaga menjadi tidak ambigu, dengan biaya bahwa satu akun belum dapat mewakili dua lembaga. Baris yang dinonaktifkan tetap disimpan, sehingga rotasi tidak menghapus riwayat.
- **ERC-1271 melalui satu `eth_call`:** aturan magic value dan kalkulasi digest dijalankan sendiri; hanya transportnya yang merupakan batas sistem. Kegagalan RPC berarti ditolak, bukan disetujui, dan tidak pernah jatuh kembali ke jalur EOA.

## Batas

Registry bukti pada ADR-0022 memiliki protokol pengesahannya sendiri dengan domain dan otorisasinya sendiri. ADR ini tidak menetapkannya, dan kewenangan ruang kerja tidak berlaku di sana. Rotasi administrator lembaga memerlukan penerimaan oleh penerusnya dan berada di luar rilis ini; administrator awal ditetapkan lewat onboarding.
