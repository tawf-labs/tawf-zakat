# ADR-0030: Akun Kerja Pribadi dan Akun Pengesahan Lembaga

- Status: Accepted — Q21 sesi `grill-with-docs`, 2026-09-15.
- Related: ADR-0023, ADR-0028, ADR-0029.

Setiap petugas memakai akun kerja pribadi yang ditautkan ke lembaga untuk atribusi pekerjaan. Akun bersama digunakan sebagai akun pengesahan lembaga. Riwayat membedakan operator yang terautentikasi dan akun pengesah institusi; nama operator tidak ditebak dari tanda tangan wallet bersama.

Alternatif menggunakan satu wallet bersama sebagai identitas seluruh petugas tidak dipilih karena tidak dapat menjelaskan siapa menyusun atau mengesahkan pekerjaan dan tidak cukup untuk menegakkan larangan penyusun menyetujui sendiri. Pemisahan ini menambah kebutuhan onboarding, pencabutan akses, serta pengikatan tindakan operator dengan pengesahan institusi, tetapi mempertahankan identitas manusia dan representasi lembaga sebagai dua hal yang dapat diperiksa.

Nama tampilan tetap dikelola administrator lembaga; perubahan profil tidak memberi kewenangan penandatanganan. ADR-0023 tetap mengatur akses ruang kerja yang tersedia sekarang. Protokol baru, model pemetaan operator ke akun institusi, penanganan beberapa akun milik orang yang sama, dan pemulihan akses harus dirinci serta diuji sebelum diklaim memenuhi keputusan ini. Akun kerja pribadi bukan fitur autentikasi tambahan yang dianggap sudah tersedia hanya karena ADR ini diterima.
