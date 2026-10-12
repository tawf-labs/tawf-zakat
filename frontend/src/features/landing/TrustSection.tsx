import { Link } from "@tanstack/react-router";
import { Container } from "../../components/layout/Container";

const points = [
  {
    word: "Mudah.",
    body: "Berdonasi tanpa akun dan tanpa dompet digital. Pilih kampanye, tentukan nominal, lalu bayar lewat halaman pembayaran resmi.",
  },
  {
    word: "Terpercaya.",
    body: "Setiap kampanye diperiksa sebelum terbit, dan laporan penggunaan dananya diperiksa sebelum tampil. Donasi Anda dapat dicek kembali kapan saja dengan kode buktinya.",
  },
  {
    word: "Menginspirasi.",
    body: "Ikuti kabar langsung dari penggalang, lihat siapa saja yang ikut membantu, dan titipkan doa bersama donasi Anda.",
  },
];

export function TrustSection() {
  return (
    <section aria-labelledby="kepercayaan-heading" className="py-20 bg-white">
      <Container>
        <h2 id="kepercayaan-heading" className="sr-only">
          Mudah, terpercaya, menginspirasi
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-12">
          {points.map((point) => (
            <div key={point.word} className="space-y-3">
              <p className="font-serif text-4xl sm:text-5xl lg:text-4xl xl:text-5xl font-bold tracking-tight text-[#17332c]">{point.word}</p>
              <p className="text-base text-[#5e7a70] leading-relaxed">{point.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-12 text-sm text-[#5e7a70]">
          Sudah berdonasi?{" "}
          <Link to="/verifikasi" className="font-semibold text-[#1b765e] underline decoration-[#1b765e]/40 underline-offset-4 hover:decoration-[#1b765e]">
            Cek bukti donasi Anda
          </Link>
        </p>
      </Container>
    </section>
  );
}
