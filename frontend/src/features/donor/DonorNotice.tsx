import { AlertCircle } from "lucide-react";

export function Notice({ tone, children }: { tone: "info" | "warning" | "error"; children: React.ReactNode }) {
  const tones = {
    info: "border-tawf-green-10 bg-[#f4f8f3] text-tawf-green",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-700",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border p-4 flex items-start gap-3 text-xs leading-relaxed ${tones[tone]}`}>
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
