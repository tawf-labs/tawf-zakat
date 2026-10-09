import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  api,
  apiUrl,
  categories,
  money,
  saveSession,
  sessionToken,
  statusLabel,
  type Campaign,
  type User,
} from "./client";
import { Notice } from "./PublicCampaigns";
import { ChainEvidence } from "./CampaignDetail";
import {
  FileText,
  FileUp,
  History,
  ShieldAlert,
  ShieldCheck,
  CheckCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FilePlus2,
  FileEdit,
  Send,
  Sparkles,
  RefreshCw,
  HeartHandshake,
  RotateCcw,
  PauseCircle,
  Clock,
  MessageSquareQuote,
  Layers,
  ArrowUp,
} from "lucide-react";

// Every private completion is bound to its initiating mount, credential and generation.
function useSessionGuard() {
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  return {
    capture: () => {
      const token = sessionToken();
      const version = generation.current;
      return () =>
        alive.current &&
        version === generation.current &&
        token === sessionToken();
    },
    invalidate: () => {
      generation.current++;
    },
    generation,
  };
}

function AccountForm({ onLogin }: { onLogin: (user: User) => void }) {
  const scope = useSessionGuard();
  const [register, setRegister] = useState(false);
  const [kind, setKind] = useState("INDIVIDUAL");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = scope.capture();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string; user: User }>(
        register ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          body: register ? { ...values, kind } : values,
          public: true,
        },
      );
      if (!current()) return;
      saveSession(data.token);
      onLogin(data.user);
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Tidak dapat masuk.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <div className="cf-account-grid">
      <section>
        <span className="cf-eyebrow">GALANG DANA DENGAN CERITA YANG JELAS</span>
        <h1>
          Niat baik Anda,
          <br />
          <em>dimulai di sini.</em>
        </h1>
        <p>
          Untuk individu maupun organisasi. Siapkan cerita, kebutuhan, anggaran,
          persetujuan penerima manfaat, dan rencana distribusi.
        </p>
        <ol className="cf-account-steps">
          <li>Buat akun penggalang dana</li>
          <li>Simpan proposal dan dokumen privat</li>
          <li>Ajukan review sebelum publikasi</li>
        </ol>
        <Notice>
          Setiap pengajuan proposal melewati proses review dan verifikasi
          operator sebelum dapat diterbitkan dan menerima donasi publik.
        </Notice>
      </section>
      <form onSubmit={submit} className="cf-panel cf-form">
        <h2>{register ? "Buat akun penggalang" : "Masuk ke akun Anda"}</h2>
        <p>
          Akun crowdfunding terpisah dari akun ruang kerja lembaga. Operator
          masuk menggunakan akun yang telah diprovisikan.
        </p>
        {register && (
          <>
            <label>
              Nama lengkap
              <input name="name" required maxLength={120} autoComplete="name" />
            </label>
            <label>
              Jenis penggalang
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="INDIVIDUAL">Individu</option>
                <option value="ORGANIZATION">Organisasi</option>
              </select>
            </label>
            {kind === "ORGANIZATION" && (
              <label>
                Nama organisasi
                <input name="organizationName" required maxLength={160} />
              </label>
            )}
          </>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Kata sandi
          <input
            name="password"
            type="password"
            minLength={register ? 12 : undefined}
            maxLength={128}
            required
            autoComplete={register ? "new-password" : "current-password"}
          />
          {register && (
            <span className="cf-small">Gunakan sedikitnya 12 karakter.</span>
          )}
        </label>
        {error && <Notice error>{error}</Notice>}
        <button disabled={busy} className="cf-button">
          {busy
            ? "Memproses…"
            : register
              ? "Daftar sebagai penggalang"
              : "Masuk"}
        </button>
        <button
          type="button"
          className="cf-text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "Sudah punya akun? Masuk" : "Belum punya akun? Daftar"}
        </button>
      </form>
    </div>
  );
}
const textFields = [
  ["title", "Judul kampanye"],
  ["summary", "Ringkasan publik"],
  ["story", "Cerita lengkap (publik)"],
  ["beneficiaryName", "Nama penerima manfaat (privat)"],
  ["relationship", "Hubungan dengan penerima manfaat"],
  ["budgetPlan", "Rincian rencana anggaran"],
  ["distributionPlan", "Rencana distribusi dan pelaporan"],
] as const;
const fieldLimits = {
  title: 160,
  summary: 500,
  story: 20000,
  beneficiaryName: 200,
  relationship: 500,
  budgetPlan: 10000,
  distributionPlan: 10000,
};
function ProposalForm({
  campaign,
  onSave,
}: {
  campaign?: Campaign;
  onSave: (campaign: Campaign) => void;
}) {
  const scope = useSessionGuard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = scope.capture();
    const form = new FormData(event.currentTarget);
    if (!String(form.get("coverImageUrl") || "").trim())
      form.delete("coverImageUrl");
    const body = {
      ...Object.fromEntries(form),
      targetAmount: Number(form.get("targetAmount")),
      endsAt: new Date(`${form.get("endsAt")}T23:59:59`).toISOString(),
      consent: form.get("consent") === "on",
    };
    setBusy(true);
    setError("");
    try {
      const data = await api<{ campaign: Campaign }>(
        campaign ? `/campaigns/${campaign.id}` : "/campaigns",
        { method: campaign ? "PATCH" : "POST", body },
      );
      if (current()) onSave(data.campaign);
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Proposal gagal disimpan.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <form className="cf-panel cf-form" onSubmit={submit}>
      <h2>{campaign ? "Perbaiki proposal" : "Proposal kampanye baru"}</h2>
      <p>
        Judul, ringkasan, cerita, dan sampul akan menjadi publik setelah terbit.
        Jangan cantumkan identitas sensitif di bidang publik.
      </p>
      {textFields.map(([name, label]) => (
        <label key={name}>
          {label}
          {["title", "beneficiaryName", "relationship"].includes(name) ? (
            <input
              name={name}
              aria-label={label}
              required
              defaultValue={campaign?.[name] || ""}
              maxLength={fieldLimits[name]}
            />
          ) : (
            <textarea
              name={name}
              aria-label={label}
              required
              rows={name === "story" ? 6 : 3}
              maxLength={fieldLimits[name]}
              defaultValue={campaign?.[name] || ""}
            />
          )}
        </label>
      ))}
      <div className="cf-form-row">
        <label>
          Kategori
          <select name="category" defaultValue={campaign?.category || "HEALTH"}>
            {Object.entries(categories).map(([key, value]) => (
              <option value={key} key={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target dana (Rp)
          <input
            name="targetAmount"
            type="number"
            min="1000"
            step="1"
            max="1000000000000"
            required
            defaultValue={campaign?.targetAmount}
          />
        </label>
      </div>
      <label>
        Tanggal akhir
        <input
          name="endsAt"
          type="date"
          required
          min={new Date().toLocaleDateString("en-CA")}
          defaultValue={campaign?.endsAt?.slice(0, 10)}
        />
      </label>
      <label>
        URL sampul (HTTPS, opsional)
        <input
          name="coverImageUrl"
          type="url"
          pattern="https://.*"
          maxLength={2048}
          defaultValue={campaign?.coverImageUrl || ""}
          placeholder="https://…"
        />
      </label>
      <label className="cf-checkbox">
        <input
          type="checkbox"
          name="consent"
          required
          defaultChecked={campaign?.consent}
        />{" "}
        Saya memiliki persetujuan penerima manfaat untuk pengajuan dan
        penggunaan informasi yang relevan.
      </label>
      {error && <Notice error>{error}</Notice>}
      <button className="cf-button" disabled={busy}>
        {busy ? "Menyimpan…" : "Simpan draf proposal"}
      </button>
    </form>
  );
}
const checkLabels = {
  identity: "Identitas penggalang diperiksa",
  consent: "Persetujuan penerima manfaat diperiksa",
  needs: "Kebutuhan dan bukti pendukung diperiksa",
  budget: "Rencana anggaran diperiksa",
  distribution: "Rencana distribusi diperiksa",
};
function ReviewForm({
  busy,
  action,
}: {
  busy: boolean;
  action: (suffix: string, body?: unknown) => Promise<void>;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  return (
    <section className="cf-panel cf-form">
      <h2>Review privat operator</h2>
      <p>
        Persetujuan harus didukung seluruh pemeriksaan dan referensi kepatuhan.
        Tidak ada pendaftaran mandiri untuk peran operator.
      </p>
      {Object.entries(checkLabels).map(([key, label]) => (
        <label className="cf-checkbox" key={key}>
          <input
            type="checkbox"
            checked={Boolean(checks[key])}
            onChange={(e) => setChecks({ ...checks, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <label>
        Referensi pemeriksaan kepatuhan
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Nomor dokumen / dasar pemeriksaan"
        />
      </label>
      <label>
        Catatan keputusan
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
        />
      </label>
      <div className="cf-actions">
        <button
          className="cf-button"
          disabled={
            busy ||
            !notes.trim() ||
            !reference.trim() ||
            !Object.keys(checkLabels).every((key) => checks[key])
          }
          onClick={() =>
            void action("review", {
              decision: "APPROVE",
              notes,
              checks,
              complianceReference: reference,
            })
          }
        >
          Setujui proposal
        </button>
        <button
          className="cf-button cf-secondary"
          disabled={busy || !notes.trim()}
          onClick={() =>
            void action("review", { decision: "REQUEST_REVISION", notes })
          }
        >
          Minta revisi
        </button>
        <button
          className="cf-button cf-danger"
          disabled={busy || !notes.trim()}
          onClick={() => void action("review", { decision: "REJECT", notes })}
        >
          Tolak
        </button>
      </div>
    </section>
  );
}
function formatDateTime(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return (
      new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d) + " WIB"
    );
  } catch {
    return isoString;
  }
}

interface ReviewChecklist {
  identity?: boolean;
  consent?: boolean;
  needs?: boolean;
  budget?: boolean;
  distribution?: boolean;
}

interface ReviewNoteItem {
  decision?: string;
  notes?: string;
  checks?: ReviewChecklist;
  complianceReference?: string;
  version?: number;
  at?: string;
}

function parseReviewNotes(raw: unknown): ReviewNoteItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "object" && item !== null) return item as ReviewNoteItem;
        if (typeof item === "string") return { notes: item };
        return null;
      })
      .filter((x): x is ReviewNoteItem => x !== null);
  }
  if (typeof raw === "object") return [raw as ReviewNoteItem];
  if (typeof raw === "string") return [{ notes: raw }];
  return [];
}

const reviewCheckLabels: Record<keyof ReviewChecklist, string> = {
  identity: "Identitas Penggalang",
  consent: "Persetujuan Penerima Manfaat",
  needs: "Kebutuhan & Bukti Pendukung",
  budget: "Rencana Anggaran Biaya",
  distribution: "Rencana Distribusi / Penyaluran",
};

function ReviewNotesCard({ notes }: { notes: unknown }) {
  const items = parseReviewNotes(notes);
  if (!items.length) return null;

  return (
    <div className="cf-review-container">
      {items.map((item, idx) => {
        const decisionKey = (item.decision || "").toUpperCase();
        const isApproved = decisionKey === "APPROVE";
        const isRevision =
          decisionKey === "REQUEST_REVISION" || decisionKey === "REVISE";
        const isRejected = decisionKey === "REJECT";
        const isReopened = decisionKey === "REOPEN";

        const badgeClass = isApproved
          ? "cf-review-badge approve"
          : isRevision
            ? "cf-review-badge revision"
            : isRejected
              ? "cf-review-badge reject"
              : isReopened
                ? "cf-review-badge reopen"
                : "cf-review-badge default";

        const BadgeIcon = isApproved
          ? CheckCircle2
          : isRevision
            ? AlertCircle
            : isRejected
              ? XCircle
              : isReopened
                ? RotateCcw
                : FileText;

        const badgeLabel = isApproved
          ? "Proposal Disetujui"
          : isRevision
            ? "Perlu Revisi / Perbaikan"
            : isRejected
              ? "Proposal Ditolak"
              : isReopened
                ? "Revisi Material Dibuka"
                : item.decision || "Catatan Evaluasi";

        return (
          <div key={idx} className="cf-review-card">
            <div className="cf-review-header">
              <div className="cf-review-header-left">
                <span className={badgeClass}>
                  <BadgeIcon size={14} />
                  <span>{badgeLabel}</span>
                </span>
                {item.version != null && (
                  <span className="cf-review-ver">Versi {item.version}</span>
                )}
              </div>
              {item.at && (
                <span className="cf-review-meta">
                  <Clock size={12} />
                  {formatDateTime(item.at)}
                </span>
              )}
            </div>

            {item.notes && (
              <div className="cf-review-quote">
                <div className="cf-review-quote-label">
                  <MessageSquareQuote size={12} />
                  <span>Catatan & Masukan Reviewer</span>
                </div>
                <p className="cf-review-text">{item.notes}</p>
              </div>
            )}

            {item.checks && Object.keys(item.checks).length > 0 && (
              <div className="cf-review-checks-wrap">
                <span className="cf-review-checks-title">
                  Verifikasi Kepatuhan & Syariah
                </span>
                <div className="cf-review-checks">
                  {(
                    Object.keys(reviewCheckLabels) as Array<
                      keyof ReviewChecklist
                    >
                  ).map((k) => {
                      const checked = item.checks?.[k];
                      if (checked === undefined) return null;
                      return (
                        <div
                          key={k}
                          className={`cf-check-item ${checked ? "passed" : "failed"}`}
                        >
                          {checked ? (
                            <CheckCircle2
                              size={14}
                              className="cf-check-icon passed"
                            />
                          ) : (
                            <XCircle size={14} className="cf-check-icon failed" />
                          )}
                          <span>{checkLabels[k]}</span>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            )}

            {item.complianceReference && (
              <div className="cf-review-footer">
                <span className="cf-compliance-ref">
                  <ShieldCheck size={13} />
                  Referensi Kepatuhan: <strong>{item.complianceReference}</strong>
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface HistoryItem {
  id?: string;
  actorId?: string;
  action?: string;
  reason?: string;
  version?: number;
  at?: string;
}

const actionMap: Record<
  string,
  {
    title: string;
    defaultDesc?: string;
    icon: typeof FileText;
    color: "teal" | "blue" | "amber" | "green" | "red" | "purple" | "slate";
  }
> = {
  CREATE: {
    title: "Draf Proposal Dibuat",
    defaultDesc: "Inisiasi pembuatan proposal penggalangan dana.",
    icon: FilePlus2,
    color: "teal",
  },
  EDIT: {
    title: "Draf Proposal Diperbarui",
    defaultDesc: "Pembaruan rincian rencana atau cerita kampanye disimpan.",
    icon: FileEdit,
    color: "blue",
  },
  DOCUMENT: {
    title: "Dokumen Privat Diunggah",
    defaultDesc: "Berkas pendukung verifikasi telah ditambahkan.",
    icon: FileUp,
    color: "blue",
  },
  SUBMIT: {
    title: "Proposal Diajukan untuk Review",
    defaultDesc: "Proposal dibekukan dan dikirim ke tim kurasi.",
    icon: Send,
    color: "amber",
  },
  REQUEST_REVISION: {
    title: "Reviewer Meminta Revisi",
    defaultDesc: "Terdapat data atau berkas yang perlu disesuaikan.",
    icon: AlertCircle,
    color: "amber",
  },
  REVISE: {
    title: "Catatan Revisi Diberikan",
    defaultDesc: "Terdapat catatan perbaikan dari tim peninjau.",
    icon: AlertCircle,
    color: "amber",
  },
  APPROVE: {
    title: "Proposal Disetujui",
    defaultDesc: "Proposal telah lolos verifikasi kepatuhan dan syariah.",
    icon: CheckCircle2,
    color: "green",
  },
  REJECT: {
    title: "Proposal Ditolak",
    defaultDesc: "Proposal belum memenuhi kriteria kelayakan program.",
    icon: XCircle,
    color: "red",
  },
  PUBLISH: {
    title: "Kampanye Diterbitkan",
    defaultDesc: "Kampanye resmi tayang ke publik dan siap menerima donasi.",
    icon: Sparkles,
    color: "green",
  },
  REOPEN: {
    title: "Revisi Material Dibuka",
    defaultDesc: "Perubahan diperbolehkan dengan penjedaan donasi sementara.",
    icon: RotateCcw,
    color: "purple",
  },
  STATUS: {
    title: "Perubahan Status Kampanye",
    icon: RefreshCw,
    color: "slate",
  },
  SUSPENDED: {
    title: "Kampanye Ditangguhkan",
    defaultDesc: "Penerimaan donasi dijeda sementara waktu.",
    icon: PauseCircle,
    color: "amber",
  },
  CLOSED: {
    title: "Kampanye Selesai & Ditutup",
    defaultDesc: "Masa penggalangan dana telah resmi berakhir.",
    icon: CheckCheck,
    color: "slate",
  },
  CANCELLED: {
    title: "Kampanye Dibatalkan",
    icon: XCircle,
    color: "red",
  },
  PAYMENT: {
    title: "Donasi Diterima",
    defaultDesc: "Transaksi donatur berhasil terverifikasi.",
    icon: HeartHandshake,
    color: "green",
  },
  REFUND: {
    title: "Pengembalian Donasi",
    icon: RotateCcw,
    color: "amber",
  },
};

function parseHistory(raw?: unknown[]): HistoryItem[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "object" && item !== null) return item as HistoryItem;
      return null;
    })
    .filter((x): x is HistoryItem => x !== null);
}

function ActivityTimeline({ history }: { history?: unknown[] }) {
  const items = parseHistory(history);
  if (!items.length) {
    return (
      <p className="cf-timeline-empty">
        Belum ada riwayat aktivitas yang tercatat.
      </p>
    );
  }

  const sorted = [...items].reverse();

  return (
    <div className="cf-timeline">
      {sorted.map((item, index) => {
        const key = (item.action || "").toUpperCase();
        const conf = actionMap[key] || {
          title: item.action ? `Aktivitas: ${item.action}` : "Pembaruan Kampanye",
          icon: History,
          color: "slate",
        };
        const IconComponent = conf.icon;

        let displayReason = item.reason;
        if (item.reason === "Version frozen for operator review") {
          displayReason =
            "Data proposal dan dokumen dikunci untuk proses evaluasi operator.";
        } else if (item.reason === "Operator published approved version") {
          displayReason =
            "Kampanye mulai tayang di halaman publik dan siap menerima donasi.";
        }

        return (
          <div key={item.id || index} className="cf-timeline-item">
            <div className={`cf-timeline-dot ${conf.color}`}>
              <IconComponent size={13} />
            </div>
            <div className="cf-timeline-content">
              <div className="cf-timeline-top">
                <span className="cf-timeline-title">{conf.title}</span>
                <div className="cf-timeline-meta">
                  {item.version != null && (
                    <span className="cf-timeline-ver">Versi {item.version}</span>
                  )}
                  {item.at && (
                    <span className="cf-timeline-time">
                      <Clock size={11} />
                      {formatDateTime(item.at)}
                    </span>
                  )}
                </div>
              </div>
              {displayReason ? (
                <div className="cf-timeline-note">
                  <p>{displayReason}</p>
                </div>
              ) : conf.defaultDesc ? (
                <p className="cf-timeline-desc">{conf.defaultDesc}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TabKey =
  | "all"
  | "proposal"
  | "documents"
  | "history"
  | "operator"
  | "evidence";

function PrivateCampaign({
  campaign,
  user,
  onRefresh,
}: {
  campaign: Campaign;
  user: User;
  onRefresh: (campaign: Campaign) => void;
}) {
  const scope = useSessionGuard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [nextStatus, setNextStatus] = useState("SUSPENDED");
  const [revisionReason, setRevisionReason] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const operator = user.role === "OPERATOR";
  const editable =
    !operator && ["DRAFT", "REVISION_REQUESTED"].includes(campaign.status);

  const hasOperatorActions =
    operator &&
    (campaign.status === "SUBMITTED" ||
      campaign.status === "APPROVED" ||
      ["PUBLISHED", "SUSPENDED", "APPROVED"].includes(campaign.status));

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function refresh(current: () => boolean) {
    if (!current()) return;
    const data = await api<{ campaign: Campaign }>(`/campaigns/${campaign.id}`);
    if (current()) onRefresh(data.campaign);
  }
  async function action(suffix: string, body?: unknown) {
    const current = scope.capture();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/campaigns/${campaign.id}/${suffix}`, {
        method: "POST",
        body: ["review", "publish", "reopen"].includes(suffix)
          ? {
              ...((body as Record<string, unknown>) || {}),
              expectedVersion: campaign.version,
            }
          : body,
      });
      await refresh(current);
      if (current()) setMessage("Perubahan berhasil disimpan.");
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Tindakan gagal.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    const current = scope.capture();
    setError("");
    if (
      file.size > 2 * 1024 * 1024 ||
      !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
    ) {
      setError("Gunakan PDF, JPEG, atau PNG maksimal 2 MB.");
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (!current()) return;
      await api(`/campaigns/${campaign.id}/documents`, {
        method: "POST",
        body: { name: file.name, contentType: file.type, dataBase64 },
      });
      await refresh(current);
      if (current()) setMessage("Dokumen privat berhasil diunggah.");
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Unggah gagal.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function download(id: string, name: string) {
    const current = scope.capture();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        apiUrl(`/campaigns/${campaign.id}/documents/${id}`),
        { headers: { Authorization: `Bearer ${sessionToken()}` } },
      );
      if (!response.ok) throw new Error("Dokumen tidak dapat diakses.");
      const blob = await response.blob();
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Unduh gagal.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <>
      <section className="cf-panel">
        <span className="cf-badge">
          {statusLabel[campaign.status] || campaign.status} · VERSI{" "}
          {campaign.version}
        </span>
        <h2>{campaign.title}</h2>
        <p>
          Oleh {campaign.organizer.organizationName || campaign.organizer.name}
        </p>
        {Boolean(campaign.reviewNotes) && (
          <ReviewNotesCard notes={campaign.reviewNotes} />
        )}
        {error && <Notice error>{error}</Notice>}
        {message && <Notice>{message}</Notice>}
        {campaign.status === "PUBLISHED" && (
          <Link
            to="/kampanye/$campaignId"
            params={{ campaignId: campaign.id }}
            className="cf-text-button"
          >
            Buka halaman publik ↗
          </Link>
        )}
      </section>

      {/* Sticky Tab Navigation Sub-Bar */}
      <nav aria-label="Navigasi bagian kampanye" className="cf-tab-nav">
        <button
          type="button"
          className={`cf-tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          <Layers size={14} />
          <span>Semua Bagian</span>
        </button>
        <button
          type="button"
          className={`cf-tab-btn ${activeTab === "proposal" ? "active" : ""}`}
          onClick={() => {
            if (activeTab === "all") scrollToSection("section-proposal");
            else setActiveTab("proposal");
          }}
        >
          <FileText size={14} />
          <span>{editable ? "Perbaiki Proposal" : "Detail Proposal"}</span>
        </button>
        <button
          type="button"
          className={`cf-tab-btn ${activeTab === "documents" ? "active" : ""}`}
          onClick={() => {
            if (activeTab === "all") scrollToSection("section-documents");
            else setActiveTab("documents");
          }}
        >
          <FileUp size={14} />
          <span>Dokumen Privat</span>
          {campaign.documents?.length ? (
            <span className="cf-tab-count">{campaign.documents.length}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`cf-tab-btn ${activeTab === "history" ? "active" : ""}`}
          onClick={() => {
            if (activeTab === "all") scrollToSection("section-history");
            else setActiveTab("history");
          }}
        >
          <History size={14} />
          <span>Riwayat & Review</span>
          {campaign.history?.length ? (
            <span className="cf-tab-count">{campaign.history.length}</span>
          ) : null}
        </button>
        {hasOperatorActions && (
          <button
            type="button"
            className={`cf-tab-btn ${activeTab === "operator" ? "active" : ""}`}
            onClick={() => {
              if (activeTab === "all") scrollToSection("section-operator");
              else setActiveTab("operator");
            }}
          >
            <ShieldAlert size={14} />
            <span>Aksi Operator</span>
          </button>
        )}
        <button
          type="button"
          className={`cf-tab-btn ${activeTab === "evidence" ? "active" : ""}`}
          onClick={() => {
            if (activeTab === "all") scrollToSection("section-evidence");
            else setActiveTab("evidence");
          }}
        >
          <ShieldCheck size={14} />
          <span>Bukti On-Chain</span>
        </button>
      </nav>

      {/* Quick Jump Bar in All View Mode */}
      {activeTab === "all" && (
        <div className="cf-jump-nav">
          <span className="cf-jump-label">Pintasan Cepat:</span>
          <button
            type="button"
            className="cf-jump-btn"
            onClick={() => scrollToSection("section-proposal")}
          >
            📋 Proposal
          </button>
          <button
            type="button"
            className="cf-jump-btn"
            onClick={() => scrollToSection("section-documents")}
          >
            📁 Dokumen ({campaign.documents?.length || 0})
          </button>
          <button
            type="button"
            className="cf-jump-btn"
            onClick={() => scrollToSection("section-history")}
          >
            ⏱️ Riwayat ({campaign.history?.length || 0})
          </button>
          {hasOperatorActions && (
            <button
              type="button"
              className="cf-jump-btn"
              onClick={() => scrollToSection("section-operator")}
            >
              🛡️ Operator
            </button>
          )}
          <button
            type="button"
            className="cf-jump-btn"
            onClick={() => scrollToSection("section-evidence")}
          >
            ⛓️ Bukti On-Chain
          </button>
        </div>
      )}

      {/* 1. PROPOSAL SECTION */}
      {(activeTab === "all" || activeTab === "proposal") && (
        <div id="section-proposal">
          {editable ? (
            <ProposalForm
              key={`${campaign.id}-${campaign.version}`}
              campaign={campaign}
              onSave={onRefresh}
            />
          ) : (
            <section className="cf-panel">
              <h2>Proposal yang diajukan</h2>
              <p>
                <strong>Target:</strong> {money(campaign.targetAmount)} ·{" "}
                <strong>Kategori:</strong> {categories[campaign.category]}
                <br />
                <strong>Berakhir:</strong>{" "}
                {new Date(campaign.endsAt).toLocaleDateString("id-ID", {
                  dateStyle: "long",
                })}
                <br />
                <strong>Pernyataan persetujuan penggalang:</strong>{" "}
                {campaign.consent
                  ? "Diberikan; tetap perlu diperiksa operator"
                  : "Belum diberikan"}
              </p>
              {textFields.map(([name, label]) => (
                <div key={name}>
                  <h3>{label}</h3>
                  <p className="cf-preline">
                    {campaign[name] || "Tidak tersedia"}
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* 2. DOCUMENTS SECTION */}
      {(activeTab === "all" || activeTab === "documents") && (
        <div id="section-documents">
          <section className="cf-panel cf-form">
            <h2>Dokumen pendukung privat</h2>
            <p>
              Hanya pemilik dan operator berwenang yang dapat mengakses dokumen.
              Tidak ditampilkan pada halaman publik.
            </p>
            {campaign.documents?.length ? (
              campaign.documents.map((doc) => (
                <button
                  disabled={busy}
                  className="cf-text-button"
                  key={doc.id}
                  onClick={() => void download(doc.id, doc.name)}
                >
                  Unduh {doc.name}
                </button>
              ))
            ) : (
              <p>Belum ada dokumen.</p>
            )}
            {editable && (
              <label>
                Unggah dokumen (PDF, JPEG, PNG · maks. 2 MB)
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  disabled={busy}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {editable && (
              <button
                className="cf-button"
                disabled={busy}
                onClick={() => void action("submit")}
              >
                Ajukan untuk review
              </button>
            )}
          </section>
        </div>
      )}

      {/* 3. OPERATOR ACTIONS */}
      {(activeTab === "all" || activeTab === "operator") && hasOperatorActions && (
        <div id="section-operator">
          {operator && campaign.status === "SUBMITTED" && (
            <ReviewForm busy={busy} action={action} />
          )}
          {operator && campaign.status === "APPROVED" && (
            <section className="cf-panel">
              <h2>Siap dipublikasikan</h2>
              <p>
                Publikasi menampilkan cerita kampanye; dokumen pendukung tetap
                privat.
              </p>
              <button
                className="cf-button"
                disabled={busy}
                onClick={() => void action("publish")}
              >
                Terbitkan kampanye
              </button>
            </section>
          )}
          {operator &&
            ["PUBLISHED", "SUSPENDED", "APPROVED"].includes(campaign.status) && (
              <section className="cf-panel cf-form">
                <h2>Kelola status kampanye</h2>
                <label>
                  Status tujuan
                  <select
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                  >
                    <option value="SUSPENDED">Tangguhkan</option>
                    <option value="CLOSED">Tutup</option>
                    <option value="CANCELLED">Batalkan</option>
                  </select>
                </label>
                <label>
                  Alasan perubahan
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  className="cf-button cf-secondary"
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void action("status", { status: nextStatus, reason })
                  }
                >
                  Simpan status
                </button>
              </section>
            )}
          {operator &&
            ["APPROVED", "PUBLISHED", "SUSPENDED"].includes(campaign.status) && (
              <section className="cf-panel cf-form">
                <h2>Revisi material kampanye</h2>
                <p>
                  Donasi dijeda sampai proposal disetujui dan diterbitkan ulang.
                  Jika sudah pernah terbit, publik tetap melihat versi terakhir yang
                  diterbitkan; perubahan draf tetap privat selama review.
                </p>
                <label>
                  Alasan revisi material
                  <textarea
                    value={revisionReason}
                    maxLength={5000}
                    rows={3}
                    onChange={(e) => setRevisionReason(e.target.value)}
                  />
                </label>
                <button
                  className="cf-button cf-secondary"
                  disabled={busy || !revisionReason.trim()}
                  onClick={() =>
                    void action("reopen", { reason: revisionReason })
                  }
                >
                  Minta revisi material
                </button>
              </section>
            )}
        </div>
      )}

      {/* 4. CHAIN EVIDENCE */}
      {(activeTab === "all" || activeTab === "evidence") && (
        <div id="section-evidence">
          <ChainEvidence campaign={campaign} />
        </div>
      )}

      {/* 5. HISTORY & REVIEW SECTION */}
      {(activeTab === "all" || activeTab === "history") && (
        <div id="section-history">
          <section className="cf-panel">
            <div className="cf-section-card-header">
              <div>
                <span className="cf-eyebrow">TRANSPARANSI PROSES</span>
                <h2>Riwayat pengajuan</h2>
              </div>
              <span className="cf-counter-pill">
                {campaign.history?.length || 0} aktivitas
              </span>
            </div>
            <p className="cf-section-desc">
              Catatan kronologis setiap pembaruan proposal, pengajuan, dan evaluasi tim verifikasi.
            </p>
            {activeTab === "history" && Boolean(campaign.reviewNotes) && (
              <div style={{ marginBottom: "20px" }}>
                <ReviewNotesCard notes={campaign.reviewNotes} />
              </div>
            )}
            <ActivityTimeline history={campaign.history} />
          </section>
        </div>
      )}

      {/* Floating Back to Top Button */}
      {showScrollTop && (
        <button
          type="button"
          className="cf-back-top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Kembali ke atas"
        >
          <ArrowUp size={15} />
          <span>Ke Atas</span>
        </button>
      )}
    </>
  );
}
export function ManageCampaigns() {
  const scope = useSessionGuard();
  const renderCurrent = scope.capture();
  const [user, setUser] = useState<User>();
  const [ready, setReady] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Campaign>();
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const current = scope.capture();
    if (!sessionToken()) {
      setReady(true);
      return;
    }
    api<{ user: User }>("/auth/me")
      .then((data) => {
        if (current()) setUser(data.user);
      })
      .catch((e) => {
        if (!current()) return;
        setError(e.message);
        setReady(true);
        saveSession(null);
      })
      .finally(() => {
        if (current()) setReady(true);
      });
  }, []);
  async function load(account = user) {
    if (!account || !renderCurrent()) return;
    const current = scope.capture();
    setLoading(true);
    setError("");
    try {
      const data = await api<{ campaigns: Campaign[] }>(
        account.role === "OPERATOR" ? "/review" : "/mine",
      );
      if (current()) setCampaigns(data.campaigns);
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Daftar tidak tersedia.");
    } finally {
      if (current()) setLoading(false);
    }
  }
  useEffect(() => {
    if (user) void load(user);
  }, [user]);
  async function select(id: string) {
    if (!renderCurrent()) return;
    const current = scope.capture();
    setLoading(true);
    setError("");
    try {
      const data = await api<{ campaign: Campaign }>(`/campaigns/${id}`);
      if (!current()) return;
      setSelected(data.campaign);
      setCreating(false);
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Detail tidak tersedia.");
    } finally {
      if (current()) setLoading(false);
    }
  }
  function saved(campaign: Campaign) {
    if (!renderCurrent()) return;
    setSelected(campaign);
    setCreating(false);
    void load();
  }
  async function logout() {
    // Capture the old credential synchronously, then hide private data immediately.
    const request = api("/auth/logout", { method: "POST" }).catch(
      () => undefined,
    );
    scope.invalidate();
    saveSession(null);
    setUser(undefined);
    setSelected(undefined);
    setCampaigns([]);
    setCreating(false);
    setLoading(false);
    setError("");
    setMessage("");
    await request; // No completion may mutate the next account's view.
  }
  return (
    <main className="cf cf-page" id="main-content">
      <div className="cf-container">
        {!ready ? (
          <Notice>Memeriksa sesi akun…</Notice>
        ) : !user ? (
          <>
            {error && <Notice error>{error}</Notice>}
            <AccountForm onLogin={setUser} />
          </>
        ) : (
          <>
            <div className="cf-section-heading">
              <div>
                <span className="cf-eyebrow">
                  {user.role === "OPERATOR"
                    ? "REVIEW PRIVAT OPERATOR"
                    : "RUANG PENGGALANG DANA"}
                </span>
                <h1>
                  {user.role === "OPERATOR"
                    ? "Periksa dengan saksama."
                    : "Mari tumbuhkan kebaikan."}
                </h1>
                <p>
                  {user.name} ·{" "}
                  {user.organizationName ||
                    (user.kind === "ORGANIZATION" ? "Organisasi" : "Individu")}
                </p>
              </div>
              <button
                className="cf-button cf-secondary"
                onClick={() => void logout()}
              >
                Keluar
              </button>
            </div>
            {error && (
              <Notice error>
                {error}{" "}
                <button className="cf-text-button" onClick={() => void load()}>
                  Coba lagi
                </button>
              </Notice>
            )}
            {message && <Notice>{message}</Notice>}
            <div className="cf-manage-grid">
              <aside className="cf-panel cf-campaign-list">
                <h2>
                  {user.role === "OPERATOR"
                    ? "Antrean & kampanye"
                    : "Kampanye Anda"}
                </h2>
                {user.role !== "OPERATOR" && (
                  <button
                    className="cf-button"
                    onClick={() => {
                      setCreating(true);
                      setSelected(undefined);
                    }}
                  >
                    + Buat kampanye
                  </button>
                )}
                <button
                  className="cf-text-button"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  Muat ulang daftar
                </button>
                {loading && <p role="status">Memuat…</p>}
                {!loading && !campaigns.length && <p>Belum ada kampanye.</p>}
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    disabled={loading}
                    aria-pressed={selected?.id === c.id}
                    className="cf-list-item"
                    onClick={() => void select(c.id)}
                  >
                    <strong>{c.title}</strong>
                    <span>{statusLabel[c.status] || c.status}</span>
                  </button>
                ))}
                {user.role === "OPERATOR" && (
                  <button
                    className="cf-text-button"
                    disabled={loading}
                    onClick={async () => {
                      const current = scope.capture();
                      setLoading(true);
                      setError("");
                      try {
                        await api("/chain/retry", { method: "POST" });
                        if (!current()) return;
                        setMessage(
                          "Permintaan pencatatan ulang blockchain telah dikirim. Konfirmasi belum dijamin.",
                        );
                        await load();
                        if (current() && selected) await select(selected.id);
                      } catch (e) {
                        if (current())
                          setError(
                            e instanceof Error ? e.message : "Retry gagal.",
                          );
                      } finally {
                        if (current()) setLoading(false);
                      }
                    }}
                  >
                    Coba ulang antrean blockchain
                  </button>
                )}
              </aside>
              <div>
                {creating ? (
                  <ProposalForm
                    key={`${user.id}-${scope.generation.current}`}
                    onSave={saved}
                  />
                ) : selected ? (
                  <PrivateCampaign
                    key={`${user.id}-${scope.generation.current}-${selected.id}`}
                    campaign={selected}
                    user={user}
                    onRefresh={saved}
                  />
                ) : (
                  <div className="cf-empty">
                    <h2>
                      {user.role === "OPERATOR"
                        ? "Pilih kampanye untuk ditinjau"
                        : "Setiap kebaikan dimulai dari satu langkah"}
                    </h2>
                    <p>
                      {user.role === "OPERATOR"
                        ? "Detail identitas, dokumen pendukung, dan catatan review hanya tersedia untuk akun berwenang."
                        : "Buat proposal atau pilih kampanye untuk melanjutkan draf dan menanggapi revisi."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
