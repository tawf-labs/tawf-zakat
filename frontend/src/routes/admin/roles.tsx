import React, { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  UserX,
  ExternalLink,
  Copy,
  Check,
  Info,
  Layers,
  Sparkles,
  ArrowLeft,
  Activity,
  Lock,
  Unlock,
} from "lucide-react";
import {
  ZAKAT_PROTOCOL_L1_ADDRESS,
  ZAKAT_PROTOCOL_ABI,
  GOVERNANCE_ROLES,
  SAFE_DPS_MULTISIG_ADDRESS,
  SEPOLIA_EXPLORER_URL,
} from "../../lib/contracts";
import { useTxToast } from "../../lib/useTxToast";
import type { Hex } from "viem";

export const Route = createFileRoute('/admin/roles')({
  component: AdminRolesPage,
});

interface RoleMember {
  id: number;
  roleHash: string;
  roleName: string;
  accountAddress: string;
  isActive: boolean;
  grantedAtBlock?: number;
  revokedAtBlock?: number;
  txHash?: string;
}

interface OnchainEventItem {
  id: number;
  txHash: string;
  blockNumber: number;
  eventName: string;
  argsJson: string;
  createdAt: string;
}

const ROLE_DEFINITIONS = [
  {
    key: "DEFAULT_ADMIN_ROLE",
    hash: GOVERNANCE_ROLES.DEFAULT_ADMIN_ROLE,
    name: "Super Admin & Amil Lead",
    badge: "Otoritas Sistem",
    color: "emerald",
    description:
      "Memegang wewenang konfigurasi parameter smart contract, alokasi operasional amil, dan manajemen pemberian/pencabutan peran on-chain.",
    mandate: "Administrasi Protokol & Keuangan",
  },
  {
    key: "SHARIA_SUPERVISOR_ROLE",
    hash: GOVERNANCE_ROLES.SHARIA_SUPERVISOR_ROLE,
    name: "Dewan Pengawas Syariah (DPS)",
    badge: "Hak Veto Syariah 2-of-3",
    color: "amber",
    description:
      "Memegang hak veto keabsahan mustahik 8 Asnaf sesuai syariat Islam dan BAZNAS. Dijalankan melalui akun Safe.global Multisig.",
    mandate: "Kepatuhan Fikih & Validasi Asnaf",
  },
  {
    key: "AUDITOR_ROLE",
    hash: GOVERNANCE_ROLES.AUDITOR_ROLE,
    name: "Auditor Independen (KAP)",
    badge: "Ex-Post Attestation",
    color: "blue",
    description:
      "Bertindak pasca-penyaluran (ex-post) untuk memverifikasi bukti BAST, mutasi rekening, dan menerbitkan stempel atestasi WTP di ledger L1.",
    mandate: "Audit Kepatuhan & Transparansi",
  },
  {
    key: "RELAYER_ROLE",
    hash: GOVERNANCE_ROLES.RELAYER_ROLE,
    name: "Automated Relayer Engine",
    badge: "Batching Fiat & Sync",
    color: "purple",
    description:
      "Layanan backend terpercaya untuk mencatat batch donasi fiat QRIS/VA dan Merkle Root ke Sepolia L1 secara terprogram.",
    mandate: "Infrastruktur Sinkronisasi Data",
  },
];

function AdminRolesPage() {
  const { address, isConnected } = useAccount();
  const { trackTx, showSuccess, showError } = useTxToast();
  const { writeContractAsync } = useWriteContract();

  const [roleMembers, setRoleMembers] = useState<RoleMember[]>([]);
  const [events, setEvents] = useState<OnchainEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  // Grant Form State
  const [selectedRoleHash, setSelectedRoleHash] = useState<string>(
    GOVERNANCE_ROLES.SHARIA_SUPERVISOR_ROLE
  );
  const [targetAddress, setTargetAddress] = useState("");
  const [isSubmittingGrant, setIsSubmittingGrant] = useState(false);

  // Revoke Dialog State
  const [revokeTarget, setRevokeTarget] = useState<{
    roleHash: string;
    roleName: string;
    account: string;
  } | null>(null);
  const [isSubmittingRevoke, setIsSubmittingRevoke] = useState(false);

  // Check if connected user has DEFAULT_ADMIN_ROLE
  const { data: isAdminOnChain, refetch: refetchAdminStatus } = useReadContract({
    address: ZAKAT_PROTOCOL_L1_ADDRESS as Hex,
    abi: ZAKAT_PROTOCOL_ABI,
    functionName: "hasRole",
    args: address ? [GOVERNANCE_ROLES.DEFAULT_ADMIN_ROLE as Hex, address as Hex] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const isAdmin = Boolean(isAdminOnChain);

  const fetchRosterAndEvents = async () => {
    try {
      setLoading(true);
      const [rolesRes, eventsRes] = await Promise.all([
        fetch("/api/governance/roles").then((r) => r.json()),
        fetch("/api/events?limit=30").then((r) => r.json()),
      ]);

      if (rolesRes.success && rolesRes.roles) {
        setRoleMembers(rolesRes.roles);
      }
      if (eventsRes.success && eventsRes.events) {
        setEvents(eventsRes.events);
      }
    } catch (err) {
      console.error("Failed to load governance data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRosterAndEvents();
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAddress(text);
    showSuccess("Alamat Tersalin", "Alamat dompet berhasil disalin ke papan klip.");
    setTimeout(() => setCopiedAddress(null), 2500);
  };

  // Handle Grant Role on Sepolia L1
  const handleGrantRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address) {
      showError("Silakan sambungkan dompet Web3 Anda terlebih dahulu.");
      return;
    }
    if (!isAdmin) {
      showError("Hanya Super Admin yang berwenang memberikan hak akses role on-chain.");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress.trim())) {
      showError("Format alamat Ethereum tidak valid (harus 42 karakter diawali 0x).");
      return;
    }

    try {
      setIsSubmittingGrant(true);
      const target = targetAddress.trim() as Hex;
      const role = selectedRoleHash as Hex;

      const txHash = await writeContractAsync({
        address: ZAKAT_PROTOCOL_L1_ADDRESS as Hex,
        abi: ZAKAT_PROTOCOL_ABI,
        functionName: "grantRole",
        args: [role, target],
      });

      await trackTx({
        txHash,
        pendingMessage: "Mengajukan pemberian role di Sepolia L1...",
        successTitle: "Hak Akses Role Berhasil Diberikan!",
        successDescription: `Role telah resmi aktif on-chain untuk ${target.slice(0, 8)}...`,
        onSuccess: () => {
          setTargetAddress("");
          fetchRosterAndEvents();
          refetchAdminStatus();
        },
      });
    } catch (err) {
      showError(err, "Gagal Memberikan Role");
    } finally {
      setIsSubmittingGrant(false);
    }
  };

  // Handle Revoke Role on Sepolia L1
  const handleRevokeRole = async () => {
    if (!revokeTarget) return;
    if (!isConnected || !address) {
      showError("Silakan sambungkan dompet Web3 Anda.");
      return;
    }
    if (!isAdmin) {
      showError("Hanya Super Admin yang berwenang mencabut role on-chain.");
      return;
    }

    try {
      setIsSubmittingRevoke(true);
      const target = revokeTarget.account as Hex;
      const role = revokeTarget.roleHash as Hex;

      const txHash = await writeContractAsync({
        address: ZAKAT_PROTOCOL_L1_ADDRESS as Hex,
        abi: ZAKAT_PROTOCOL_ABI,
        functionName: "revokeRole",
        args: [role, target],
      });

      await trackTx({
        txHash,
        pendingMessage: "Mencabut wewenang role di Sepolia L1...",
        successTitle: "Hak Akses Role Berhasil Dicabut!",
        successDescription: `Wewenang telah dinonaktifkan untuk ${target.slice(0, 8)}...`,
        onSuccess: () => {
          setRevokeTarget(null);
          fetchRosterAndEvents();
          refetchAdminStatus();
        },
      });
    } catch (err) {
      showError(err, "Gagal Mencabut Role");
    } finally {
      setIsSubmittingRevoke(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f8faf8] text-[#17332c] pb-24">
      {/* Top Banner & Header */}
      <section className="bg-gradient-to-b from-emerald-900 via-[#17332c] to-[#10241f] text-white pt-12 pb-16 px-4 sm:px-6 lg:px-8 border-b border-emerald-900/60 shadow-inner">
        <div className="max-w-7xl mx-auto">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#c4ed70] hover:text-white transition-colors mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            Kembali ke Beranda
          </Link>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-[#c4ed70] text-xs font-semibold uppercase tracking-widest mb-3">
                <Shield className="w-3.5 h-3.5" />
                Tata Kelola Syariah & Multisig L1
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white mb-3">
                Otorisasi & Manajemen Peran On-Chain
              </h1>
              <p className="text-sm sm:text-base text-emerald-100/80 max-w-2xl leading-relaxed">
                Transparansi mutlak hak akses keabsahan fikih (DPS), audit independen, dan amil operasional yang tercatat secara permanen di smart contract Sepolia.
              </p>
            </div>

            {/* Admin Connection Status Pill */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 p-4 sm:p-5 flex flex-col gap-2 min-w-[280px]">
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200/80 flex items-center justify-between">
                <span>Status Akses Dompet</span>
                {isAdmin ? (
                  <span className="flex items-center gap-1.5 text-[#c4ed70] font-bold">
                    <Unlock className="w-3.5 h-3.5" /> Super Admin
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-300 font-medium">
                    <Lock className="w-3.5 h-3.5" /> Mode Publik (Read-Only)
                  </span>
                )}
              </div>
              <div className="font-mono text-xs text-white/90 truncate bg-black/20 px-3 py-2 rounded-xl">
                {isConnected && address ? address : "Dompet belum tersambung"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6">
        {/* Notice for Non-Admins */}
        {!isAdmin && (
          <div className="mb-8 bg-amber-50/90 border border-amber-200/80 rounded-2xl p-4 sm:p-5 shadow-xs flex items-start gap-3.5">
            <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-amber-900 leading-relaxed">
              <strong className="font-semibold">Mode Transparansi Publik Aktif:</strong> Anda dapat memeriksa seluruh daftar resmi ustadz Dewan Pengawas Syariah (DPS) dan Auditor yang berwenang di blockchain. Aksi penambahan/pencabutan peran dikunci khusus untuk Super Admin demi menjaga integritas protokol.
            </div>
          </div>
        )}

        {/* 4 Role Roster Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {ROLE_DEFINITIONS.map((role) => {
            const members = roleMembers.filter(
              (m) =>
                m.roleHash.toLowerCase() === role.hash.toLowerCase() ||
                m.roleName === role.key
            );

            return (
              <div
                key={role.key}
                className="bg-white rounded-2xl border border-[#dbe7dd] shadow-sm hover:shadow-md transition-all p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-[#1b765e] border border-emerald-100">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {role.badge}
                    </span>
                    <span className="text-[11px] font-mono text-gray-400">
                      {role.hash.slice(0, 8)}...{role.hash.slice(-6)}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-[#17332c] mb-1 font-serif">
                    {role.name}
                  </h3>
                  <p className="text-xs text-[#5e7a70] mb-4 leading-relaxed">
                    {role.description}
                  </p>

                  <div className="border-t border-gray-100 pt-4 mb-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center justify-between">
                      <span>Daftar Anggota Aktif ({members.length})</span>
                      <span className="text-[10px] text-[#1b765e] lowercase">{role.mandate}</span>
                    </h4>

                    {loading ? (
                      <div className="space-y-2 animate-pulse">
                        <div className="h-10 bg-gray-100 rounded-xl" />
                      </div>
                    ) : members.length === 0 ? (
                      <div className="p-4 bg-gray-50 rounded-xl text-center text-xs text-gray-400">
                        Belum ada anggota terdaftar untuk peran ini.
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                        {members.map((member) => {
                          const isSafeDps =
                            member.accountAddress.toLowerCase() ===
                            SAFE_DPS_MULTISIG_ADDRESS.toLowerCase();

                          return (
                            <div
                              key={member.id || member.accountAddress}
                              className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                                isSafeDps
                                  ? "bg-emerald-50/70 border-emerald-200"
                                  : "bg-gray-50/80 border-gray-100 hover:bg-gray-100/70"
                              }`}
                            >
                              <div className="flex flex-col min-w-0 pr-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-medium text-[#17332c] truncate">
                                    {member.accountAddress}
                                  </span>
                                  {isSafeDps && (
                                    <span className="px-2 py-0.5 rounded-full bg-[#1b765e] text-white text-[10px] font-bold tracking-wider uppercase shrink-0">
                                      Safe Multisig
                                    </span>
                                  )}
                                </div>
                                {isSafeDps && (
                                  <span className="text-[11px] text-[#1b765e] mt-0.5">
                                    Kuorum Kolektif 2-of-3 Ustadz Dewan Pengawas Syariah
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {isSafeDps && (
                                  <a
                                    href={`https://app.safe.global/home?safe=sep:${SAFE_DPS_MULTISIG_ADDRESS}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Buka Akun Safe.global DPS"
                                    className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-100 transition-colors"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(member.accountAddress)}
                                  title="Salin Alamat"
                                  className="p-1.5 rounded-lg text-gray-500 hover:text-[#17332c] hover:bg-white transition-colors cursor-pointer"
                                >
                                  {copiedAddress === member.accountAddress ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRevokeTarget({
                                        roleHash: role.hash,
                                        roleName: role.name,
                                        account: member.accountAddress,
                                      })
                                    }
                                    title="Cabut Hak Akses"
                                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
                                  >
                                    <UserX className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                  <span>Smart Contract: Sepolia L1</span>
                  <a
                    href={`${SEPOLIA_EXPLORER_URL}/address/${ZAKAT_PROTOCOL_L1_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[#1b765e] inline-flex items-center gap-1"
                  >
                    Lihat di Etherscan <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Grant Role Card Form (Admin Mode) */}
        <section className="bg-white rounded-2xl border border-[#dbe7dd] shadow-sm p-6 sm:p-8 mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-100/70 text-[#1b765e] flex items-center justify-center">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#17332c] font-serif">
                Beri Wewenang Role Baru (Grant Role)
              </h2>
              <p className="text-xs text-[#5e7a70]">
                Eksekusi transaksi on-chain untuk mendaftarkan anggota baru ke dewan syariah, auditor, atau relayer.
              </p>
            </div>
          </div>

          <form onSubmit={handleGrantRole} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#5e7a70] mb-2">
                  Pilih Peran (Role)
                </label>
                <select
                  value={selectedRoleHash}
                  onChange={(e) => setSelectedRoleHash(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-[#17332c] text-sm focus:outline-none focus:ring-2 focus:ring-[#1b765e] disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  {ROLE_DEFINITIONS.map((r) => (
                    <option key={r.key} value={r.hash}>
                      {r.name} ({r.badge})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#5e7a70] mb-2">
                  Alamat Dompet Penerima (Ethereum Address)
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={targetAddress}
                  onChange={(e) => setTargetAddress(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#1b765e] disabled:bg-gray-100 disabled:cursor-not-allowed"
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-[#5e7a70]">
                {isAdmin
                  ? "Transaksi akan diproses melalui wallet MetaMask/ConnectKit Anda."
                  : "Formulir hanya aktif jika dompet Anda memiliki hak Super Admin."}
              </span>
              <button
                type="submit"
                disabled={!isAdmin || isSubmittingGrant || !targetAddress}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#1b765e] hover:bg-[#143f34] text-white font-medium text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                {isSubmittingGrant ? "Mengirim ke Sepolia L1..." : "Beri Hak Akses On-Chain"}
              </button>
            </div>
          </form>
        </section>

        {/* Live On-Chain Events Feed */}
        <section className="bg-white rounded-2xl border border-[#dbe7dd] shadow-sm p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100/70 text-purple-700 flex items-center justify-center">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[#17332c] font-serif">
                  Jejak Audit Event On-Chain (Live Indexer Feed)
                </h2>
                <p className="text-xs text-[#5e7a70]">
                  Log event mutasi role, setoran zakat, dan otorisasi penyaluran yang ditangkap oleh mesin indexer.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchRosterAndEvents}
              className="text-xs text-[#1b765e] font-semibold hover:underline cursor-pointer"
            >
              Segarkan Data
            </button>
          </div>

          {events.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 bg-gray-50 rounded-xl">
              Belum ada event tercatat dalam log indexer.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500 uppercase tracking-wider">
                    <th className="py-2.5 px-3">Blok #</th>
                    <th className="py-2.5 px-3">Nama Event</th>
                    <th className="py-2.5 px-3">Tx Hash</th>
                    <th className="py-2.5 px-3">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono">
                  {events.map((evt) => (
                    <tr key={evt.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-2.5 px-3 text-[#1b765e] font-bold">#{evt.blockNumber}</td>
                      <td className="py-2.5 px-3 font-sans font-semibold text-[#17332c]">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[11px]">
                          {evt.eventName}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <a
                          href={`${SEPOLIA_EXPLORER_URL}/tx/${evt.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gray-600 hover:text-[#1b765e] inline-flex items-center gap-1"
                        >
                          {evt.txHash.slice(0, 10)}...{evt.txHash.slice(-6)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-gray-400">
                        {new Date(evt.createdAt).toLocaleString("id-ID")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Revoke Confirmation Modal */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-red-100">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-center text-[#17332c] mb-2 font-serif">
              Konfirmasi Cabut Hak Akses
            </h3>
            <p className="text-xs text-[#5e7a70] text-center mb-4 leading-relaxed">
              Anda akan mencabut peran <strong>{revokeTarget.roleName}</strong> dari alamat berikut pada smart contract Sepolia L1:
            </p>

            <div className="p-3 bg-gray-50 rounded-xl font-mono text-xs text-gray-700 break-all mb-6 text-center border border-gray-100">
              {revokeTarget.account}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                disabled={isSubmittingRevoke}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-medium text-xs hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleRevokeRole}
                disabled={isSubmittingRevoke}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-xs transition-colors shadow-sm cursor-pointer"
              >
                {isSubmittingRevoke ? "Memproses..." : "Ya, Cabut Wewenang"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
