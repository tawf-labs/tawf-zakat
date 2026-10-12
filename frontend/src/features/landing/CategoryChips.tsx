import { Link } from "@tanstack/react-router";
import { BookOpen, HeartPulse, LifeBuoy, Users, HandCoins } from "lucide-react";
import { Container } from "../../components/layout/Container";

const chip =
  "inline-flex min-h-12 items-center gap-2.5 rounded-full border border-[#dbe7dd] bg-white px-6 py-3 text-sm font-semibold text-[#17332c] shadow-xs transition-all hover:border-[#1b765e] hover:bg-[#f4f8f3] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1b765e]";
const causes = [
  { category: "HEALTH", label: "Bantu biaya berobat", Icon: HeartPulse },
  { category: "EDUCATION", label: "Dukung pendidikan", Icon: BookOpen },
  { category: "HUMANITARIAN", label: "Bantuan kemanusiaan", Icon: LifeBuoy },
  { category: "COMMUNITY", label: "Kuatkan komunitas", Icon: Users },
] as const;

export function CategoryChips() {
  return (
    <section aria-labelledby="pilih-kepedulian-heading" className="py-16 bg-white border-b border-[#dbe7dd]/60">
      <Container>
        <h2 id="pilih-kepedulian-heading" className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#17332c]">
          Pilih kepedulian Anda
        </h2>
        <div className="mt-6 flex flex-wrap gap-3">
          {causes.map(({ category, label, Icon }) => (
            <Link key={category} to="/kampanye" search={{ kategori: category }} className={chip}>
              <Icon className="w-4 h-4 text-[#1b765e]" aria-hidden="true" />
              {label}
            </Link>
          ))}
          <Link to="/donasi" className={chip}>
            <HandCoins className="w-4 h-4 text-[#1b765e]" aria-hidden="true" />
            Tunaikan zakat
          </Link>
        </div>
      </Container>
    </section>
  );
}
