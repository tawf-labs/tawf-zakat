import React, { useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { useReceiptCheck, type PublicContribution } from "./contributionApi";
import { MerkleProofDetails } from "./MerkleProofDetails";

const parseAmount = (raw: string) => Number(raw.replace(/[^0-9]/g, ""));

export function OwnerReceiptCheck({ contribution }: { contribution: PublicContribution }) {
  const [salt, setSalt] = useState("");
  const [amount, setAmount] = useState("");
  const check = useReceiptCheck();

  const amountIDR = parseAmount(amount);
  const canSubmit = salt.trim().length > 0 && amountIDR > 0 && !check.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) check.mutate({ trxId: contribution.trxId, salt: salt.trim(), amountIDR });
  };

  const edit = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    check.reset();
  };

  return (
    <div className="space-y-4">
      <details className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-xs group">
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <KeyRound className="w-4 h-4 text-[#1b765e]" />
          <span className="font-serif text-base font-bold text-[#17332c]">Cocokkan dengan kuitansi Anda</span>
        </summary>
        <p className="text-xs text-[#5e7a70] mt-2">
          Pemilik kuitansi dapat memasukkan kode rahasia dan nominal dari kuitansinya. Server memeriksa kecocokannya
          dengan catatan lembaga; data ini tidak ditampilkan kepada publik.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-[#17332c] space-y-1">
              <span>Kode rahasia kuitansi</span>
              <Input value={salt} onChange={edit(setSalt)} autoComplete="off" />
            </label>
            <label className="text-xs font-semibold text-[#17332c] space-y-1">
              <span>Nominal (Rp)</span>
              <Input value={amount} onChange={edit(setAmount)} inputMode="numeric" />
            </label>
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-5 py-2.5 rounded-xl bg-[#1b765e] hover:bg-[#17332c] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2"
          >
            {check.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>Cocokkan Kuitansi</span>
          </button>
          <CheckOutcome check={check} />
        </form>
      </details>

      <MerkleProofDetails contribution={contribution} check={check.data ?? null} />
    </div>
  );
}

function CheckOutcome({ check }: { check: ReturnType<typeof useReceiptCheck> }) {
  if (check.isError) {
    return (
      <Outcome tone="bg-amber-50 border-amber-200 text-amber-900" Icon={AlertTriangle}
        text="Pemeriksaan belum dapat dilakukan karena layanan tidak tersedia. Tidak ada kesimpulan yang dibuat." />
    );
  }
  if (!check.data) return null;
  return check.data.isValid ? (
    <Outcome tone="bg-emerald-50 border-emerald-200 text-emerald-900" Icon={CheckCircle2}
      text={`Kuitansi cocok dengan catatan penerimaan kelompok #${check.data.batch?.batchId} yang tersimpan di server.`} />
  ) : (
    <Outcome tone="bg-red-50 border-red-200 text-red-900" Icon={AlertCircle}
      text="Kuitansi tidak cocok dengan catatan penerimaan mana pun. Periksa kode rahasia dan nominal." />
  );
}

function Outcome({ tone, Icon, text }: { tone: string; Icon: typeof CheckCircle2; text: string }) {
  return (
    <p role="status" className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${tone}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
