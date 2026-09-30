import { useId } from "react";
export type OfficerAccountInput = { account: string; role: "OFFICER" | "READER" };
export function OfficerAccountFields({ value, change, optional = false }: {
  value: OfficerAccountInput; change: (value: OfficerAccountInput) => void; optional?: boolean;
}) {
  const id = useId();
  return <div className="grid gap-3 sm:grid-cols-2">
    <label htmlFor={`${id}-account`} className="block text-xs font-medium text-stone-700">Alamat akun kerja{optional ? " (opsional)" : ""}
      <input id={`${id}-account`} required={!optional} value={value.account}
        onChange={event => change({ ...value, account: event.target.value })}
        placeholder="0x..." pattern="0x[0-9a-fA-F]{40}" className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-mono text-xs text-stone-800 placeholder:text-stone-400 focus:border-[#1b765e] focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
    </label>
    <label htmlFor={`${id}-role`} className="block text-xs font-medium text-stone-700">Peran akun
      <select id={`${id}-role`} value={value.role} onChange={event => change({ ...value, role: event.target.value as OfficerAccountInput["role"] })}
        className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-800 focus:border-[#1b765e] focus:outline-none focus:ring-2 focus:ring-emerald-500/20">
        <option value="OFFICER">Petugas</option><option value="READER">Pembaca berwenang</option>
      </select>
    </label>
  </div>;
}
