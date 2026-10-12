import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Container } from "../../components/layout/Container";

export function Hero() {
  return (
    <section className="relative bg-[#eaf3e8] border-b border-[#dbe7dd] py-16 sm:py-24 lg:py-28 overflow-hidden">
      {/* Ambient background light */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-[radial-gradient(circle,rgba(196,237,112,0.3),transparent_70%)] pointer-events-none -z-10" />

      <Container>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <div className="lg:col-span-7 flex flex-col items-start text-left space-y-7">
            <h1 className="font-serif text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-[#17332c] leading-[1.08]">
              Berbagi kebaikan,{" "}
              <em className="text-[#1b765e] font-serif italic font-normal">
                lihat sampai ke mana ia tiba.
              </em>
            </h1>

            <p className="text-base sm:text-lg text-[#1e3e36] leading-relaxed max-w-xl">
              Infak untuk kampanye yang sudah diperiksa, atau tunaikan zakat Anda.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                to="/kampanye"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#17332c] hover:bg-[#1b765e] px-8 py-4 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]"
              >
                <span>Donasi Sekarang</span>
                <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link
                to="/donasi"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#17332c]/25 bg-white/70 hover:bg-white px-8 py-4 text-sm font-semibold text-[#17332c] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]"
              >
                Tunaikan Zakat
              </Link>
            </div>

            <Link
              to="/galang-dana"
              className="text-sm font-semibold text-[#1b765e] underline decoration-[#1b765e]/40 underline-offset-4 hover:decoration-[#1b765e]"
            >
              Ingin menggalang dana? Mulai di sini
            </Link>
          </div>

          <div className="lg:col-span-5 flex items-center justify-center">
            <div className="relative w-full max-w-lg">
              <img
                src="/zktbg.png"
                alt=""
                className="w-full h-auto max-h-[460px] object-contain drop-shadow-md transform hover:scale-[1.02] transition-transform duration-300"
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
