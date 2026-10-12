import { useState } from "react";
import {
  api,
  apiUrl,
  money,
  sessionToken,
  type Campaign,
  type CampaignUpdate,
  type User,
} from "./client";
import { Notice } from "./PublicCampaigns";

const kindLabel: Record<string, string> = {
  NEWS: "Kabar",
  REALIZATION: "Laporan realisasi",
};
const updateStatusLabel: Record<string, string> = {
  DRAFT: "Draf",
  SUBMITTED: "Menunggu pemeriksaan",
  REVISION_REQUESTED: "Perlu perbaikan",
  REJECTED: "Ditolak",
  PUBLISHED: "Terbit",
  WITHDRAWN: "Ditarik",
};
const decisionLabel: Record<string, string> = {
  PUBLISH: "Diterbitkan",
  REQUEST_REVISION: "Diminta perbaikan",
  REJECT: "Ditolak",
  WITHDRAW: "Ditarik",
};
const day = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString("id-ID", { dateStyle: "long" })
    : "";
const attachmentUrl = (campaignId: string, updateId: string, id: string) =>
  apiUrl(`/campaigns/${campaignId}/updates/${updateId}/attachments/${id}`);
const canReport = (campaign: Campaign) =>
  Boolean(campaign.publishedAt) && campaign.status !== "CANCELLED";

function UpdateFacts({ update }: { update: CampaignUpdate }) {
  if (update.kind !== "REALIZATION" || !update.usedAmount) return null;
  return (
    <p className="cf-update-facts">
      <strong>{money(update.usedAmount)}</strong> dilaporkan digunakan ·
      kegiatan {day(update.carriedOutAt)}
    </p>
  );
}

export function FundUseSummary({ campaign }: { campaign: Campaign }) {
  const used = campaign.reportedUsedAmount || 0;
  return (
    <>
      <dl className="cf-funds">
        <div>
          <dt>Dana terkumpul</dt>
          <dd>{money(campaign.collectedAmount)}</dd>
        </div>
        <div>
          <dt>Dilaporkan digunakan</dt>
          <dd>{money(used)}</dd>
        </div>
        <div>
          <dt>Belum dilaporkan</dt>
          <dd>{money(Math.max(0, campaign.collectedAmount - used))}</dd>
        </div>
      </dl>
      <p className="cf-small">
        Nominal penggunaan dilaporkan oleh penggalang dan diperiksa operator
        terhadap lampiran yang diserahkan. Pemeriksaan bukan jaminan kebenaran
        seluruh klaim, bukan saldo rekening, dan bukan bukti bantuan telah
        diterima penerima manfaat.
      </p>
    </>
  );
}

export function PublicUpdates({ campaign }: { campaign: Campaign }) {
  const updates = campaign.updates || [];
  const titleOf = (id?: string) => updates.find((u) => u.id === id)?.title;
  return (
    <section className="cf-panel" id="kabar-laporan">
      <span className="cf-eyebrow">PERKEMBANGAN & PERTANGGUNGJAWABAN</span>
      <h2>Kabar & Laporan</h2>
      <FundUseSummary campaign={campaign} />
      {!updates.length && (
        <p className="cf-update-empty">
          Belum ada kabar atau laporan realisasi yang diterbitkan untuk kampanye
          ini.
        </p>
      )}
      {updates.map((update) =>
        update.status === "WITHDRAWN" ? (
          <article className="cf-update cf-update-muted" key={update.id}>
            <div className="cf-update-head">
              <span className="cf-update-kind">{kindLabel[update.kind]}</span>
              <span className="cf-update-state">Ditarik</span>
            </div>
            <h3>{update.title}</h3>
            <p>
              Ditarik operator pada {day(update.withdrawnAt)}:{" "}
              {update.withdrawnReason}
            </p>
          </article>
        ) : (
          <article
            className={`cf-update ${update.supersededById ? "cf-update-muted" : ""}`}
            key={update.id}
          >
            <div className="cf-update-head">
              <span className="cf-update-kind">{kindLabel[update.kind]}</span>
              <span className="cf-small">
                Terbit {day(update.publishedAt)} ·{" "}
                {update.kind === "REALIZATION"
                  ? "diperiksa operator"
                  : "ditulis penggalang"}
              </span>
            </div>
            <h3>{update.title}</h3>
            {update.correctsId && (
              <p className="cf-update-note">
                Koreksi atas:{" "}
                {titleOf(update.correctsId) || "laporan sebelumnya"}
              </p>
            )}
            {update.supersededById && (
              <p className="cf-update-note">
                Telah dikoreksi oleh:{" "}
                {titleOf(update.supersededById) || "laporan yang lebih baru"}.
                Nominal pada catatan ini tidak lagi dihitung.
              </p>
            )}
            <UpdateFacts update={update} />
            <p className="cf-preline">{update.body}</p>
            {Boolean(update.attachments?.length) && (
              <ul className="cf-attachments">
                {update.attachments!.map((file) => {
                  const href = attachmentUrl(campaign.id, update.id, file.id);
                  return (
                    <li key={file.id}>
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {file.contentType.startsWith("image/") && (
                          <img src={href} alt="" loading="lazy" />
                        )}
                        <span>{file.name}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        ),
      )}
    </section>
  );
}

type Draft = {
  kind: string;
  title: string;
  body: string;
  usedAmount: string;
  carriedOutAt: string;
  correctsId: string;
};
const blank: Draft = {
  kind: "NEWS",
  title: "",
  body: "",
  usedAmount: "",
  carriedOutAt: "",
  correctsId: "",
};

function UpdateForm({
  campaign,
  existing,
  busy,
  onSave,
  onCancel,
}: {
  campaign: Campaign;
  existing?: CampaignUpdate;
  busy: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(
    existing
      ? {
          kind: existing.kind,
          title: existing.title,
          body: existing.body || "",
          usedAmount: existing.usedAmount ? String(existing.usedAmount) : "",
          carriedOutAt: existing.carriedOutAt || "",
          correctsId: existing.correctsId || "",
        }
      : blank,
  );
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const realization = draft.kind === "REALIZATION";
  const correctable = (campaign.updates || []).filter(
    (u) =>
      u.status === "PUBLISHED" && !u.supersededById && u.kind === draft.kind,
  );
  return (
    <form
      className="cf-form cf-update-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      {!existing && (
        <div className="cf-form-row">
          <label>
            Jenis
            <select
              value={draft.kind}
              onChange={(e) => set({ kind: e.target.value, correctsId: "" })}
            >
              <option value="NEWS">Kabar — perkembangan kegiatan</option>
              <option value="REALIZATION">
                Laporan realisasi — penggunaan dana
              </option>
            </select>
          </label>
          <label>
            Mengoreksi catatan terbit (opsional)
            <select
              value={draft.correctsId}
              onChange={(e) => set({ correctsId: e.target.value })}
            >
              <option value="">Bukan koreksi</option>
              {correctable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label>
        Judul
        <input
          required
          maxLength={160}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      {realization && (
        <div className="cf-form-row">
          <label>
            Nominal yang digunakan (Rp)
            <input
              type="number"
              required
              min="1"
              step="1"
              value={draft.usedAmount}
              onChange={(e) => set({ usedAmount: e.target.value })}
            />
          </label>
          <label>
            Tanggal pelaksanaan
            <input
              type="date"
              required
              value={draft.carriedOutAt}
              onChange={(e) => set({ carriedOutAt: e.target.value })}
            />
          </label>
        </div>
      )}
      <label>
        {realization
          ? "Penggunaan dana dan hasil kegiatan"
          : "Isi kabar untuk publik"}
        <textarea
          required
          rows={5}
          maxLength={10000}
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
        />
      </label>
      <p className="cf-small">
        {realization
          ? "Teks ini tampil ke publik setelah diperiksa operator."
          : "Kabar langsung tampil ke publik saat Anda menerbitkannya dan tidak dapat diubah setelah itu."}{" "}
        Jangan menuliskan data pribadi penerima manfaat.
      </p>
      <div className="cf-actions">
        <button className="cf-button" disabled={busy}>
          Simpan draf
        </button>
        <button
          type="button"
          className="cf-text-button"
          disabled={busy}
          onClick={onCancel}
        >
          Batal
        </button>
      </div>
    </form>
  );
}

function OperatorReview({
  update,
  busy,
  onDecide,
}: {
  update: CampaignUpdate;
  busy: boolean;
  onDecide: (decision: string, notes: string, publicIds: string[]) => void;
}) {
  const [notes, setNotes] = useState("");
  const [released, setReleased] = useState<string[]>([]);
  const proposed = (update.attachments || []).filter(
    (a) => a.visibility === "PUBLIC",
  );
  return (
    <div className="cf-form cf-update-form">
      <h3>Pemeriksaan operator</h3>
      {proposed.length > 0 && (
        <fieldset className="cf-update-release">
          <legend>Lampiran yang diusulkan tampil ke publik</legend>
          {proposed.map((file) => (
            <label className="cf-checkbox" key={file.id}>
              <input
                type="checkbox"
                checked={released.includes(file.id)}
                onChange={(e) =>
                  setReleased(
                    e.target.checked
                      ? [...released, file.id]
                      : released.filter((id) => id !== file.id),
                  )
                }
              />{" "}
              Tampilkan {file.name} — sudah diperiksa, tanpa data sensitif
            </label>
          ))}
        </fieldset>
      )}
      <label>
        Catatan pemeriksaan (privat)
        <textarea
          rows={3}
          maxLength={5000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="cf-actions">
        <button
          className="cf-button"
          disabled={busy || !notes.trim()}
          onClick={() => onDecide("PUBLISH", notes, released)}
        >
          Terbitkan
        </button>
        <button
          className="cf-button cf-secondary"
          disabled={busy || !notes.trim()}
          onClick={() => onDecide("REQUEST_REVISION", notes, [])}
        >
          Minta perbaikan
        </button>
        <button
          className="cf-button cf-danger"
          disabled={busy || !notes.trim()}
          onClick={() => onDecide("REJECT", notes, [])}
        >
          Tolak
        </button>
      </div>
    </div>
  );
}

export function ManageUpdates({
  campaign,
  user,
  guard,
  onRefresh,
}: {
  campaign: Campaign;
  user: User;
  guard: { capture: () => () => boolean };
  onRefresh: (campaign: Campaign) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [visibility, setVisibility] = useState("PRIVATE");
  const [withdrawal, setWithdrawal] = useState<Record<string, string>>({});
  const operator = user.role === "OPERATOR";
  const updates = campaign.updates || [];
  const base = `/campaigns/${campaign.id}/updates`;

  async function run(task: () => Promise<unknown>, done: string) {
    const current = guard.capture();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      if (!current()) return false;
      const data = await api<{ campaign: Campaign }>(
        `/campaigns/${campaign.id}`,
      );
      if (!current()) return false;
      onRefresh(data.campaign);
      setMessage(done);
      return true;
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Tindakan gagal.");
      return false;
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function save(draft: Draft, existing?: CampaignUpdate) {
    const realization = draft.kind === "REALIZATION";
    const fields = {
      title: draft.title,
      body: draft.body,
      ...(realization
        ? {
            usedAmount: Number(draft.usedAmount),
            carriedOutAt: draft.carriedOutAt,
          }
        : {}),
    };
    const saved = await run(
      () =>
        existing
          ? api(`${base}/${existing.id}`, { method: "PATCH", body: fields })
          : api(base, {
              method: "POST",
              body: {
                ...fields,
                kind: draft.kind,
                ...(draft.correctsId ? { correctsId: draft.correctsId } : {}),
              },
            }),
      realization
        ? "Draf tersimpan. Tambahkan lampiran bila perlu, lalu ajukan untuk diperiksa."
        : "Draf tersimpan. Tambahkan foto bila perlu, lalu terbitkan.",
    );
    if (saved) setEditing(null);
  }
  async function upload(update: CampaignUpdate, file?: File) {
    if (!file) return;
    const news = update.kind === "NEWS";
    const types = [
      "image/jpeg",
      "image/png",
      ...(news ? [] : ["application/pdf"]),
    ];
    if (file.size > 2 * 1024 * 1024 || !types.includes(file.type)) {
      setError(
        news
          ? "Gunakan foto JPEG atau PNG maksimal 2 MB."
          : "Gunakan PDF, JPEG, atau PNG maksimal 2 MB.",
      );
      return;
    }
    await run(async () => {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api(`${base}/${update.id}/attachments`, {
        method: "POST",
        body: {
          name: file.name,
          contentType: file.type,
          dataBase64,
          visibility: news ? "PUBLIC" : visibility,
        },
      });
    }, "Lampiran berhasil diunggah.");
  }
  async function download(update: CampaignUpdate, id: string, name: string) {
    const current = guard.capture();
    setError("");
    try {
      const response = await fetch(attachmentUrl(campaign.id, update.id, id), {
        headers: { Authorization: `Bearer ${sessionToken()}` },
      });
      if (!response.ok) throw new Error("Lampiran tidak dapat diakses.");
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
    }
  }

  if (!canReport(campaign))
    return (
      <section className="cf-panel">
        <h2>Kabar & Laporan</h2>
        <p>
          Kabar dan laporan realisasi dapat dikirim setelah kampanye
          diterbitkan.
        </p>
      </section>
    );
  return (
    <section className="cf-panel">
      <div className="cf-section-card-header">
        <div>
          <span className="cf-eyebrow">PERKEMBANGAN & PERTANGGUNGJAWABAN</span>
          <h2>Kabar & Laporan</h2>
        </div>
        <span className="cf-counter-pill">{updates.length} catatan</span>
      </div>
      <p className="cf-section-desc">
        {operator
          ? "Periksa laporan realisasi sebelum tampil pada halaman publik kampanye. Kabar terbit langsung oleh penggalang dan dapat Anda tarik bila perlu."
          : "Kabar langsung terbit saat Anda menerbitkannya. Laporan realisasi diperiksa operator sebelum tampil ke publik."}
      </p>
      <FundUseSummary campaign={campaign} />
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {!operator &&
        (editing === "new" ? (
          <UpdateForm
            campaign={campaign}
            busy={busy}
            onSave={(draft) => void save(draft)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button
            className="cf-button"
            disabled={busy}
            onClick={() => setEditing("new")}
          >
            Tulis kabar atau laporan
          </button>
        ))}
      {!updates.length && (
        <p className="cf-update-empty">Belum ada kabar atau laporan.</p>
      )}
      {updates.map((update) => {
        const editable =
          !operator && ["DRAFT", "REVISION_REQUESTED"].includes(update.status);
        const lastNote = update.reviewNotes?.at(-1);
        const news = update.kind === "NEWS";
        return (
          <article className="cf-update" key={update.id}>
            <div className="cf-update-head">
              <span className="cf-update-kind">{kindLabel[update.kind]}</span>
              <span className="cf-update-state">
                {updateStatusLabel[update.status] || update.status}
              </span>
            </div>
            {editing === update.id ? (
              <UpdateForm
                campaign={campaign}
                existing={update}
                busy={busy}
                onSave={(draft) => void save(draft, update)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <h3>{update.title}</h3>
                {update.correctsId && (
                  <p className="cf-update-note">
                    Koreksi atas:{" "}
                    {updates.find((u) => u.id === update.correctsId)?.title}
                  </p>
                )}
                {update.supersededById && (
                  <p className="cf-update-note">
                    Telah dikoreksi oleh:{" "}
                    {updates.find((u) => u.id === update.supersededById)?.title}
                  </p>
                )}
                <UpdateFacts update={update} />
                <p className="cf-preline">{update.body}</p>
              </>
            )}
            {lastNote && (
              <p className="cf-update-note">
                {decisionLabel[lastNote.decision] || lastNote.decision}{" "}
                {day(lastNote.at)} — catatan operator: {lastNote.notes}
              </p>
            )}
            <ul className="cf-attachments cf-attachments-list">
              {(update.attachments || []).map((file) => (
                <li key={file.id}>
                  <button
                    className="cf-text-button"
                    onClick={() => void download(update, file.id, file.name)}
                  >
                    Unduh {file.name}
                  </button>
                  <span className="cf-small">
                    {file.published
                      ? "Tampil ke publik"
                      : file.visibility === "PUBLIC"
                        ? news
                          ? "Akan tampil ke publik"
                          : "Diusulkan publik"
                        : "Privat"}
                  </span>
                  {editable && (
                    <button
                      className="cf-text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api(`${base}/${update.id}/attachments/${file.id}`, {
                              method: "DELETE",
                            }),
                          "Lampiran dihapus.",
                        )
                      }
                    >
                      Hapus
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {editable && editing !== update.id && (
              <div className="cf-form cf-update-form">
                <div className="cf-form-row">
                  {!news && (
                    <label>
                      Sifat lampiran berikutnya
                      <select
                        value={visibility}
                        onChange={(e) => setVisibility(e.target.value)}
                      >
                        <option value="PRIVATE">
                          Privat — hanya operator (kuitansi, identitas)
                        </option>
                        <option value="PUBLIC">
                          Usulkan tampil ke publik (dokumentasi kegiatan)
                        </option>
                      </select>
                    </label>
                  )}
                  <label>
                    {news
                      ? "Unggah foto (JPEG, PNG · maks. 2 MB)"
                      : "Unggah lampiran (PDF, JPEG, PNG · maks. 2 MB)"}
                    <input
                      type="file"
                      accept={
                        news
                          ? "image/jpeg,image/png"
                          : "application/pdf,image/jpeg,image/png"
                      }
                      disabled={busy}
                      onChange={(e) => {
                        void upload(update, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {news && (
                  <p className="cf-small">
                    Foto pada kabar langsung tampil ke publik. Pastikan tidak
                    memuat identitas atau wajah penerima manfaat tanpa
                    persetujuan.
                  </p>
                )}
                <div className="cf-actions">
                  <button
                    className="cf-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api(`${base}/${update.id}/submit`, {
                            method: "POST",
                          }),
                        news
                          ? "Kabar terbit di halaman publik kampanye."
                          : "Diajukan untuk diperiksa operator.",
                      )
                    }
                  >
                    {news ? "Terbitkan kabar" : "Ajukan untuk diperiksa"}
                  </button>
                  <button
                    className="cf-button cf-secondary"
                    disabled={busy}
                    onClick={() => setEditing(update.id)}
                  >
                    Ubah isi
                  </button>
                  {update.status === "DRAFT" && !update.revision && (
                    <button
                      className="cf-text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api(`${base}/${update.id}`, { method: "DELETE" }),
                          "Draf dihapus.",
                        )
                      }
                    >
                      Hapus draf
                    </button>
                  )}
                </div>
              </div>
            )}
            {operator && update.status === "SUBMITTED" && (
              <OperatorReview
                update={update}
                busy={busy}
                onDecide={(decision, notes, publicAttachmentIds) =>
                  void run(
                    () =>
                      api(`${base}/${update.id}/review`, {
                        method: "POST",
                        body: {
                          expectedRevision: update.revision,
                          decision,
                          notes,
                          ...(decision === "PUBLISH"
                            ? { publicAttachmentIds }
                            : {}),
                        },
                      }),
                    "Keputusan pemeriksaan tersimpan.",
                  )
                }
              />
            )}
            {operator && update.status === "PUBLISHED" && (
              <div className="cf-form cf-update-form">
                <label>
                  Alasan penarikan (tampil ke publik)
                  <textarea
                    rows={2}
                    maxLength={5000}
                    value={withdrawal[update.id] || ""}
                    onChange={(e) =>
                      setWithdrawal({
                        ...withdrawal,
                        [update.id]: e.target.value,
                      })
                    }
                  />
                </label>
                <div className="cf-actions">
                  <button
                    className="cf-button cf-danger"
                    disabled={busy || !withdrawal[update.id]?.trim()}
                    onClick={() =>
                      void run(
                        () =>
                          api(`${base}/${update.id}/withdraw`, {
                            method: "POST",
                            body: { reason: withdrawal[update.id] },
                          }),
                        "Catatan ditarik dari halaman publik.",
                      )
                    }
                  >
                    Tarik dari publik
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
