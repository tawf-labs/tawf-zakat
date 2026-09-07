import { formatQuantity } from "../../lib/reporting";
import type { WireFigure } from "./types";

interface FigureTableProps {
  title: string;
  description: string;
  figures: WireFigure[];
}

/** One block of period figures, rendered straight from their decimal strings. */
export function FigureTable({ title, description, figures }: FigureTableProps) {
  return (
    <div className="rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs md:p-6">
      <h3 className="font-serif text-lg font-bold text-[#17332c]">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-[#5e7a70]">{description}</p>

      <dl className="mt-4 divide-y divide-[#eef4ef]">
        {figures.map((figure) => (
          <div
            key={figure.name}
            className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"
          >
            <dt className="text-sm text-[#3d5b52]">{figure.label}</dt>
            <dd className="font-mono text-sm font-semibold text-[#17332c] tabular-nums">
              {formatQuantity(figure.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
