import { useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import type { Hex } from "viem";
import { Button } from "../../components/ui/Button";
import { getApiBaseUrl } from "../../lib/contracts";
import type { Workspace } from "./workspaceClient";

export async function authorityRequest(path: string, token: string, body?: unknown) {
  const response = await fetch(`${getApiBaseUrl()}/api/workspace${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Permintaan ditolak.");
  return result;
}
const actions = {
  SIGNATORY: "Pengesah lembaga", AUDITOR: "Mandat auditor", VALIDATOR: "Validator (global)",
  PROPOSE_ADMINISTRATOR: "Usulkan administrator registry", ACCEPT_ADMINISTRATOR: "Terima administrator registry",
  PROPOSE_VALIDATOR_OPERATOR: "Usulkan operator validator", ACCEPT_VALIDATOR_OPERATOR: "Terima operator validator",
};
type Transaction = { actor: Hex; scope: string; chainId: number; to: Hex; data: Hex; value: string; change: unknown };
export function AuthorityPanel({ token, workspace }: { token: string; workspace: Workspace }) {
  const { address, chainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const [account, setAccount] = useState(workspace.account);
  const [action, setAction] = useState<keyof typeof actions>("SIGNATORY");
  const [active, setActive] = useState(false);
  const [mandate, setMandate] = useState("");
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [history, setHistory] = useState<unknown>(null);
  const [fromBlock, setFromBlock] = useState("0");
  const [hash, setHash] = useState("");
  const [receipt, setReceipt] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  async function run(name: string, work: () => Promise<void>) {
    setBusy(name); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Tindakan gagal."); }
    finally { setBusy(null); }
  }
  function invalidate() { setTransaction(null); setReviewed(false); }
  async function membership(path: string) {
    await run(path, async () => {
      await authorityRequest(path, token, { account });
      setMessage(path.endsWith("accept") ? "Serah-terima diterima. Masuk ulang untuk memakai peran baru." : "Perubahan ruang kerja tersimpan. Muat ulang daftar anggota.");
      setHistory(await authorityRequest("/authority-history", token).catch(() => null));
    });
  }
  return <section className="space-y-4 rounded-2xl border bg-white p-6">
    <h3 className="font-semibold">Pengelolaan otoritas dan akses</h3>
    <p className="text-sm">Pelaku: <code className="break-all">{workspace.account}</code> · lembaga: {workspace.institution.id} · peran ruang kerja: {workspace.role}.</p>
    <p className="text-sm">Publikasi dan atestasi yang diterima pada bloknya tetap menjadi riwayat sah. Izin tindakan baru memakai otoritas terkini. Rotasi registry dan administrator ruang kerja adalah dua kewenangan terpisah.</p>
    <label className="block text-sm">Akun yang diubah / penerus<input className="block w-full rounded border p-2 font-mono" value={account} onChange={e => { setAccount(e.target.value); invalidate(); }} /></label>
    <Button variant="outline" disabled={!!busy} onClick={() => run("roles", async () => { setSnapshot(null); setSnapshot((await authorityRequest(`/authority?account=${encodeURIComponent(account)}`, token)).authority); })}>{busy === "roles" ? "Membaca…" : "Periksa otoritas live"}</Button>
    {snapshot !== null && <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(snapshot, null, 2)}</pre>}
    <div className="space-y-3 rounded border p-3">
      <h4 className="font-medium">Perubahan registry</h4>
      <select className="w-full rounded border p-2" value={action} onChange={e => { setAction(e.target.value as keyof typeof actions); invalidate(); }}>
        {Object.entries(actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {["SIGNATORY", "AUDITOR", "VALIDATOR"].includes(action) && <label className="block"><input type="checkbox" checked={active} onChange={e => { setActive(e.target.checked); invalidate(); }} /> Aktifkan kewenangan (kosong berarti cabut)</label>}
      {action === "AUDITOR" && <label className="block">Mandat auditor<textarea className="block w-full border p-2" value={mandate} onChange={e => { setMandate(e.target.value); invalidate(); }} /></label>}
      <Button disabled={!!busy} onClick={() => run("prepare", async () => {
        invalidate(); setReceipt(null);
        const change = action.startsWith("ACCEPT") ? { action } : action.startsWith("PROPOSE") ? { action, account } : { action, account, active, ...(action === "AUDITOR" ? { mandate } : {}) };
        setTransaction((await authorityRequest("/authority/prepare", token, change)).transaction);
      })}>{busy === "prepare" ? "Memeriksa…" : "Siapkan perubahan"}</Button>
      {transaction && <>
        <p className="text-sm">Scope: {transaction.scope} · chain {transaction.chainId} · registry <code className="break-all">{transaction.to}</code></p>
        <pre className="overflow-auto text-xs">{JSON.stringify(transaction.change, null, 2)}</pre>
        <label className="block"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> Saya telah memeriksa pelaku, scope, akun dan perubahan.</label>
        {chainId !== transaction.chainId ? <Button disabled={!!busy} onClick={() => run("network", async () => { await switchChainAsync({ chainId: transaction.chainId }); })}>{busy === "network" ? "Mengganti jaringan…" : "Ganti jaringan"}</Button> :
          <Button disabled={!!busy || !reviewed || address?.toLowerCase() !== transaction.actor.toLowerCase()} onClick={() => run("send", async () => {
            // Repeat the live simulation immediately before opening the wallet.
            await authorityRequest("/authority/prepare", token, transaction.change);
            const sent = await sendTransactionAsync({ to: transaction.to, data: transaction.data, value: 0n, chainId: transaction.chainId });
            setHash(sent); setReceipt(null); setMessage("Transaksi dikirim. Periksa receipt untuk mengetahui penerimaan.");
          })}>{busy === "send" ? "Menunggu wallet…" : "Kirim perubahan"}</Button>}
        <details><summary>Calldata untuk akun Safe</summary><p className="text-sm">Eksekusi dari Safe yang memegang role. Setelah dieksekusi, masukkan hash transaksi di bawah.</p><textarea readOnly value={JSON.stringify(transaction, null, 2)} className="h-40 w-full border p-2 font-mono text-xs" /></details>
      </>}
      <label className="block text-sm">Hash transaksi registry<input className="block w-full border p-2 font-mono" value={hash} onChange={e => { setHash(e.target.value); setReceipt(null); }} /></label>
      <Button variant="outline" disabled={!!busy || !/^0x[0-9a-fA-F]{64}$/.test(hash)} onClick={() => run("receipt", async () => { setReceipt(null); setReceipt((await authorityRequest(`/authority/receipt/${hash}`, token)).receipt); })}>{busy === "receipt" ? "Memeriksa receipt…" : "Periksa receipt kanonik"}</Button>
      {receipt !== null && <pre className="max-h-72 overflow-auto text-xs">{JSON.stringify(receipt, null, 2)}</pre>}
    </div>
    <div className="space-y-3 rounded border p-3">
      <h4 className="font-medium">Akses ruang kerja</h4>
      <p className="text-sm">Pencabutan menghentikan unduhan berikutnya melalui sesi dan tautan lama. Salinan yang sudah diunduh tidak dapat dihapus dari perangkat pembaca. Penerus harus sudah menjadi anggota lembaga.</p>
      {workspace.capabilities.manageMembers && <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!!busy} onClick={() => membership("/members/revoke")}>Cabut akses akun</Button>
        <Button variant="outline" disabled={!!busy} onClick={() => membership("/administrator/propose")}>Usulkan administrator ruang kerja</Button>
      </div>}
      <Button variant="outline" disabled={!!busy} onClick={() => membership("/administrator/accept")}>Terima usulan sebagai akun sesi</Button>
      <Button variant="outline" disabled={!!busy} onClick={() => run("workspace-history", async () => { setHistory(await authorityRequest("/authority-history", token)); })}>Riwayat dan usulan ruang kerja</Button>
    </div>
    <label className="block text-sm">Riwayat registry mulai blok<input className="ml-2 border p-1" value={fromBlock} onChange={e => setFromBlock(e.target.value)} /></label>
    <Button variant="outline" disabled={!!busy} onClick={() => run("history", async () => {
      const result = await authorityRequest(`/authority/history?fromBlock=${fromBlock}`, token); setHistory(result); setFromBlock(result.nextBlock);
    })}>Baca halaman riwayat registry (maks. 2.000 blok)</Button>
    {history !== null && <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(history, null, 2)}</pre>}
    <p className="text-xs">Kehilangan seluruh otoritas memerlukan prosedur pemulihan tersendiri; operator teknis tidak dapat mengganti pengesah lembaga. Lihat runbook lokal ticket #77.</p>
    {message && <p role="status" className="rounded border p-3 text-sm">{message}</p>}
  </section>;
}
