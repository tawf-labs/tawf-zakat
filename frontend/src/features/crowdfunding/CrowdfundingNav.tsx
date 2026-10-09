import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TawfLogo } from "../../components/layout/TawfLogo";
import { Menu, X, ArrowUpRight } from "lucide-react";

export function isCrowdfundingPath(path: string) {
  return (
    path === "/" ||
    path === "/kampanye" ||
    path.startsWith("/kampanye/") ||
    path === "/galang-dana" ||
    path === "/kelola-kampanye"
  );
}
export function CrowdfundingNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-[#dce4d6] bg-[#fffdf8]/95 backdrop-blur-md">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:bg-white focus:p-4"
      >
        Lewati navigasi
      </a>
      <div className="mx-auto flex min-h-20 max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-7">
        <Link
          to="/"
          className="flex items-center gap-3"
          aria-label="TAWF beranda"
        >
          <TawfLogo />
        </Link>
        <nav
          aria-label="Navigasi utama"
          className="hidden items-center gap-7 text-sm font-medium md:flex"
        >
          <Link
            to="/kampanye"
            activeProps={{
              className: "text-[#246642] underline underline-offset-8",
            }}
          >
            Jelajahi kampanye
          </Link>
          <Link
            to="/kelola-kampanye"
            activeProps={{
              className: "text-[#246642] underline underline-offset-8",
            }}
          >
            Akun & kampanye saya
          </Link>
          <Link
            to="/galang-dana"
            className="flex min-h-11 items-center gap-2 rounded-lg bg-[#d1eb9c] px-5 text-[#24412d]"
          >
            Galang dana <ArrowUpRight size={16} />
          </Link>
        </nav>
        <button
          type="button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#cbd6c2] md:hidden"
          aria-label={open ? "Tutup menu" : "Buka menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav
          aria-label="Navigasi seluler"
          className="flex flex-col border-t border-[#dce4d6] px-5 pb-4 md:hidden"
        >
          {[
            { to: "/kampanye", label: "Jelajahi kampanye" },
            { to: "/galang-dana", label: "Galang dana" },
            { to: "/kelola-kampanye", label: "Akun & kampanye saya" },
            { to: "/ruang-kerja", label: "Ruang kerja lembaga" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center text-sm"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
