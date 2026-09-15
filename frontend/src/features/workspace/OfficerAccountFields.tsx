import { useId } from "react";
export type OfficerAccountInput = { account: string; role: "OFFICER" | "READER" };
export function OfficerAccountFields({ value, change, optional = false }: {
  value: OfficerAccountInput; change: (value: OfficerAccountInput) => void; optional?: boolean;
}) {
  const id = useId();
  return <div className="grid gap-3 sm:grid-cols-2">
    <label htmlFor={`${id}-account`} className="text-sm">Alamat akun kerja{optional ? " (opsional)" : ""}
      <input id={`${id}-account`} required={!optional} value={value.account}
        onChange={event => change({ ...value, account: event.target.value })}
        placeholder="0x..." pattern="0x[0-9a-fA-F]{40}" className="mt-1 w-full rounded-lg border p-2 font-mono text-xs" />
    </label>
    <label htmlFor={`${id}-role`} className="text-sm">Peran akun
      <select id={`${id}-role`} value={value.role} onChange={event => change({ ...value, role: event.target.value as OfficerAccountInput["role"] })}
        className="mt-1 w-full rounded-lg border p-2">
        <option value="OFFICER">Petugas</option><option value="READER">Pembaca berwenang</option>
      </select>
    </label>
  </div>;
}
