import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Container } from "../../components/layout/Container";

export function FundraiseBand() {
  return (
    <section aria-labelledby="galang-dana-heading" className="relative overflow-hidden bg-[#eaf3e8] border-y border-[#dbe7dd] py-20 text-[#17332c]">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-[radial-gradient(circle,rgba(196,237,112,0.4),transparent_70%)] pointer-events-none" />
      <Container>
        <div className="relative max-w-3xl mx-auto text-center space-y-6">
          <h2 id="galang-dana-heading" className="font-serif text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
            Galang dana bersama orang-orang yang peduli
          </h2>
          <p className="text-base sm:text-lg text-[#1e3e36] max-w-xl mx-auto leading-relaxed">
            Ajukan kebutuhan Anda, kabarkan perkembangannya, dan laporkan penggunaan dananya kepada para donatur
            dalam satu halaman kampanye.
          </p>
          <Link
            to="/galang-dana"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#17332c] hover:bg-[#1b765e] px-8 py-4 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]"
          >
            <span>Mulai Galang Dana</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </Container>
    </section>
  );
}
