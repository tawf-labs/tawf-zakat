import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  api,
  apiUrl,
  categories,
  money,
  readable,
  saveSession,
  sessionToken,
  statusLabel,
  type Campaign,
  type User,
} from "./client";
import { Notice } from "./PublicCampaigns";
import { ChainEvidence } from "./CampaignDetail";

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
  const operator = user.role === "OPERATOR";
  const editable =
    !operator && ["DRAFT", "REVISION_REQUESTED"].includes(campaign.status);
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
          <Notice>
            <strong>Catatan review</strong>
            <p className="cf-preline">{readable(campaign.reviewNotes)}</p>
          </Notice>
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
              <p className="cf-preline">{campaign[name] || "Tidak tersedia"}</p>
            </div>
          ))}
        </section>
      )}
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
              onClick={() => void action("reopen", { reason: revisionReason })}
            >
              Minta revisi material
            </button>
          </section>
        )}
      <ChainEvidence campaign={campaign} />
      <section className="cf-panel">
        <h2>Riwayat pengajuan</h2>
        {campaign.history?.length ? (
          campaign.history.map((item, index) => (
            <p className="cf-preline cf-history" key={index}>
              {readable(item)}
            </p>
          ))
        ) : (
          <p>Belum ada riwayat yang tersedia.</p>
        )}
      </section>
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
