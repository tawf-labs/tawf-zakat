# Issue #104 — akses kontribusi donatur melalui OTP tanpa akun

Tanggal: 2026-09-19. Issue: https://github.com/tawf-labs/tawf-zakat/issues/104. Induk: spec #100.

## Cakupan yang diimplementasikan

- Donatur memulai dari referensi kuitansi (ID kontribusi atau referensi sumber yang unik). Halaman publik hanya menampilkan referensi dan status lembaga (`RECEIVED`, `RECONCILED`, `ENDORSED`, `REJECTED`); ID kontribusi, lembaga, kontak, nama dan nominal tidak keluar.
- `POST /api/donor/otp-challenge` mengirim kode 6 digit ke kontak kontribusi itu sendiri. Respons tidak memuat ID kontribusi maupun kontak tersamar. Pesan hanya berisi kode dan masa berlaku.
- Kode disimpan sebagai HMAC-SHA256 dengan `DONOR_OTP_KEY`, dibandingkan timing-safe, sekali pakai, berlaku 15 menit, maksimal 5 percobaan. Hanya kode terbaru per kontribusi yang hidup.
- Batas pengiriman: cooldown 60 detik dan maksimal 5 kode per jam per kontribusi, dihitung di dalam transaksi dengan row lock pada kontribusi.
- `POST /api/donor/session` menukar kode dengan sesi 1 jam yang terikat satu kontribusi. Setiap baca memeriksa kecocokan ID path dengan sesi (IDOR, forward tautan, kontak bersama). `DELETE /api/donor/session` mencabut sesi. Token donor ditolak ruang kerja operator.
- `/api/donor/*` memakai `Cache-Control: private, no-store` dan `Vary: Authorization`.
- Alokasi hanya yang `ACTIVE`; progres pendanaan gabungan tanpa identitas/nominal donatur lain; persentase tidak ditampilkan untuk target parsial. Status ZK selalu `NOT_AVAILABLE` sampai #108.
- Frontend: sesi disimpan per referensi di sessionStorage bersama `expiresAt`, QueryClient terpisah per sesi (`gcTime: 0`). Rincian hilang saat tenggat sesi lewat, saat server menjawab 401/403, dan saat logout.

## Kanal pengiriman

Pilot memakai email melalui Resend (`RESEND_API_KEY`, `DONOR_OTP_EMAIL_FROM`), dipasang sebagai `donorMessages` terpisah dari `messages` milik #94. Kontak berupa nomor HP ditolak dengan pesan jujur bahwa kanal saat ini hanya email. Tanpa konfigurasi, `GET /api/donor/channel` menjawab `available: false` dan halaman tidak menampilkan tombol kirim. Pengiriman gagal membatalkan kode dan menjawab 502. WhatsApp (Cloud API Meta, template Authentication) belum dikonfigurasi: memerlukan verifikasi Meta Business dan nomor khusus.

Tanpa `DONOR_OTP_KEY`, server memakai kunci sementara per proses; kode tidak berlaku setelah restart atau di instance lain.

## Hasil

- `donor_otp_access_api.test.ts` pada schema PostgreSQL lokal terisolasi + Chromium: **22 pass** (termasuk smoke browser). `email_transport.test.ts`: 4 pass.
- Smoke browser: referensi → kirim kode fixture → buka rincian dan alokasi (Rp1.000.000 / Rp4.000.000, 25%) → reload tanpa kode baru → kedaluwarsa (rincian hilang, form OTP kembali) → masuk ulang → logout → reload tetap tertutup. Kode dan token tidak muncul di URL mana pun; tidak ada `pageerror`.
- Suite backend penuh: **985 pass, 23 skip, 0 fail**. `donorClient.test.ts` frontend: 5 pass. `bun run verify:ssr`: lulus.

## Batas

- Referensi sumber yang sama di dua lembaga dianggap ambigu: lookup publik menjawab tidak ditemukan, dan OTP meminta ID kontribusi dari kuitansi.
- Belum ada kanal WhatsApp/SMS; kontribusi dengan kontak nomor HP menunggu kanal tersebut atau pemulihan kontak (#105).
- Dashboard gabungan ZK/NFT/realisasi berada di #114.
