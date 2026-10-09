import { Link } from "@tanstack/react-router";
import { TawfLogo } from "./TawfLogo";

export function Footer() {
  return (
    <footer className="border-t border-[#dbe4d5] bg-[#eef2e7] px-5 py-12 text-[#244532]">
      <div className="mx-auto grid max-w-[1144px] gap-9 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Link to="/" aria-label="TAWF beranda" className="inline-flex min-h-11 items-center rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]">
            <TawfLogo />
          </Link>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#536a59]">
            Ruang untuk berbagi kepedulian dan menelusuri cerita kebaikan.
            Platform teknologi, bukan jaminan izin penghimpunan atau kepatuhan
            syariah.
          </p>
        </div>
        <nav
          aria-label="Tautan crowdfunding"
          className="flex flex-col gap-3 text-sm"
        >
          <strong>Kebaikan bersama</strong>
          <Link to="/kampanye">Jelajahi kampanye</Link>
          <Link to="/galang-dana">Mulai galang dana</Link>
          <Link to="/kelola-kampanye">Akun & pengelolaan kampanye</Link>
        </nav>
        <nav
          aria-label="Layanan institusional"
          className="flex flex-col gap-3 text-sm"
        >
          <strong>Ruang institusional</strong>
          <Link to="/ruang-kerja">Ruang kerja lembaga</Link>
          <Link to="/transparansi">Laporan & bukti publik</Link>
          <Link to="/verifikasi">Pemeriksaan bukti</Link>
          <Link to="/rekonsiliasi">Rekonsiliasi</Link>
          <Link to="/laporan-periode">Laporan periode</Link>
        </nav>
      </div>
      <div className="mx-auto mt-9 max-w-[1144px] border-t border-[#cddbc7] pt-5 text-xs leading-relaxed text-[#536a59]">
        Prototipe crowdfunding · Pembayaran Midtrans Sandbox, bukan uang nyata.
        Dana terkumpul bukan bukti penyaluran. Status blockchain ditampilkan
        sesuai data yang tersedia.
      </div>
    </footer>
  );
}
