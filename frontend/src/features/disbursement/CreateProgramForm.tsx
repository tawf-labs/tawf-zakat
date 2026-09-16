import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { createProgram, type Program, type FundType } from "./disbursementClient";

export const FUND_TYPE_LABELS: Record<FundType, string> = {
  ZAKAT: "Zakat",
  INFAK: "Infak",
  SEDEKAH: "Sedekah",
  LAINNYA: "Lainnya",
};

export function CreateProgramForm({ requests, onCreated }: { requests: PrivateRequests; onCreated: (program: Program) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fundType, setFundType] = useState<FundType>("ZAKAT");
  const [scope, setScope] = useState("");
  const [referenceCeiling, setReferenceCeiling] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus className="mr-2 h-4 w-4" /> Program baru
      </Button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const program = await createProgram(requests, {
        name,
        purpose,
        fundType,
        scope,
        referenceCeiling: referenceCeiling.trim() ? referenceCeiling.trim() : null,
      });
      onCreated(program);
      setOpen(false);
      setName("");
      setPurpose("");
      setScope("");
      setReferenceCeiling("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Program gagal dibuat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-stone-900">Program bantuan baru</h4>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Nama program
          <input className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Tujuan
          <input className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Jenis dana
          <select
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={fundType}
            onChange={(e) => setFundType(e.target.value as FundType)}
          >
            {Object.entries(FUND_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Cakupan/periode
          <input className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Pagu referensi (rupiah, opsional — peringatan, bukan saldo bank)
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={referenceCeiling}
            onChange={(e) => setReferenceCeiling(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" disabled={busy} onClick={submit}>
          {busy ? "Menyimpan…" : "Simpan program"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </div>
  );
}

