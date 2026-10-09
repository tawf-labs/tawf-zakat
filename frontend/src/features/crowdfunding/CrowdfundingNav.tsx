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
    <header className="sticky top-0 z-50 border-b border-[#dbe7dd] bg-[#f9f6f0]/95 backdrop-blur-md transition-colors">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4 focus:text-[#0f3d30]"
      >
        Lewati navigasi
      </a>
      <div className="mx-auto flex min-h-20 max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-7">
        <Link
          to="/"
          className="flex items-center gap-3 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]"
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
            className="text-[#17332c] transition-colors hover:text-[#1b765e]"
            activeProps={{
              className: "text-[#1b765e] font-semibold underline underline-offset-8 decoration-2 decoration-[#1b765e]",
            }}
          >
            Jelajahi kampanye
          </Link>
          <Link
            to="/galang-dana"
            className="flex min-h-11 items-center gap-2 rounded-full bg-[#0f3d30] px-6 text-sm font-medium text-[#f9f6f0] shadow-xs transition-all hover:bg-[#1a5242] hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]"
          >
            Galang dana <ArrowUpRight size={16} />
          </Link>
        </nav>
        <button
          type="button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[#dbe7dd] text-[#17332c] transition-colors hover:bg-[#eaf3e8] md:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]"
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
          className="flex flex-col gap-1 border-t border-[#dbe7dd] bg-[#f9f6f0] px-5 py-4 md:hidden"
        >
          {[
            { to: "/kampanye", label: "Jelajahi kampanye" },
            { to: "/galang-dana", label: "Galang dana" },
            { to: "/ruang-kerja", label: "Ruang kerja lembaga" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center rounded-lg px-3 text-sm font-medium text-[#17332c] transition-colors hover:bg-[#eaf3e8] hover:text-[#1b765e]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
