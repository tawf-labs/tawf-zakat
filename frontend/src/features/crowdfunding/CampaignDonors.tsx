import { useCallback, useEffect, useRef, useState } from "react";
import { api, money } from "./client";
import { Notice } from "./PublicCampaigns";

type Donor = {
  id: string;
  name: string | null;
  amount: number;
  paidAt: string;
  prayer?: string;
  prayerHidden?: boolean;
};
type Page = { total: number; donors: Donor[] };
const PAGE = 10;

function ago(value: string) {
  const minutes = Math.max(0, (Date.now() - Date.parse(value)) / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${Math.floor(minutes)} menit lalu`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} jam lalu`;
  if (minutes < 43200) return `${Math.floor(minutes / 1440)} hari lalu`;
  return new Date(value).toLocaleDateString("id-ID", { dateStyle: "medium" });
}

/** Confirmed donations with their prayers. `moderator` adds the operator's hide control. */
export function DonorWall({
  campaignId,
  refreshKey,
  moderator = false,
  authenticated = false,
}: {
  campaignId: string;
  refreshKey?: number;
  moderator?: boolean;
  authenticated?: boolean;
}) {
  const request = useRef(0);
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hiding, setHiding] = useState<string>();
  const [reason, setReason] = useState("");
  const path = `/campaigns/${encodeURIComponent(campaignId)}/donors`;

  const load = useCallback(
    async (offset: number) => {
      const current = ++request.current;
      setBusy(true);
      setError("");
      try {
        const data = await api<Page>(`${path}?offset=${offset}&limit=${PAGE}`, {
          public: !authenticated,
        });
        if (current !== request.current) return;
        setPage((previous) =>
          offset && previous
            ? {
                total: data.total,
                donors: [...previous.donors, ...data.donors],
              }
            : data,
        );
      } catch (e) {
        if (current === request.current)
          setError(
            e instanceof Error ? e.message : "Daftar donatur gagal dimuat.",
          );
      } finally {
        if (current === request.current) setBusy(false);
      }
    },
    [path, authenticated],
  );
  useEffect(() => {
    void load(0);
    return () => {
      request.current++;
    };
  }, [load, refreshKey]);

  async function hide(donor: Donor) {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ donor: Donor }>(
        `${path}/${donor.id}/hide-prayer`,
        { method: "POST", body: { reason } },
      );
      setPage(
        (previous) =>
          previous && {
            ...previous,
            donors: previous.donors.map((item) =>
              item.id === donor.id ? data.donor : item,
            ),
          },
      );
      setHiding(undefined);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Doa gagal disembunyikan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cf-panel" id="donatur-doa">
      <div className="cf-section-card-header">
        <div>
          <span className="cf-eyebrow">ORANG-ORANG BAIK</span>
          <h2>Donatur & Doa</h2>
        </div>
        {page && <span className="cf-counter-pill">{page.total} donasi</span>}
      </div>
      {error && (
        <Notice error>
          {error}{" "}
          <button className="cf-text-button" onClick={() => void load(0)}>
            Coba lagi
          </button>
        </Notice>
      )}
      {!page && !error && <p>Memuat donatur…</p>}
      {page && !page.total && (
        <p className="cf-update-empty">
          Belum ada donasi yang terkonfirmasi. Jadilah yang pertama mengirim
          dukungan dan doa.
        </p>
      )}
      <ul className="cf-donors">
        {page?.donors.map((donor) => {
          const name = donor.name || "Hamba Allah";
          return (
            <li key={donor.id}>
              <span className="cf-donor-avatar" aria-hidden="true">
                {donor.name ? name.charAt(0).toUpperCase() : "♥"}
              </span>
              <div className="cf-donor-body">
                <div className="cf-donor-head">
                  <strong>{name}</strong>
                  <span className="cf-small">{ago(donor.paidAt)}</span>
                </div>
                <p className="cf-donor-amount">
                  Berdonasi <strong>{money(donor.amount)}</strong>
                </p>
                {donor.prayer && (
                  <blockquote className="cf-donor-prayer cf-preline">
                    {donor.prayer}
                  </blockquote>
                )}
                {donor.prayerHidden && (
                  <p className="cf-small">Doa disembunyikan oleh operator.</p>
                )}
                {moderator &&
                  donor.prayer &&
                  (hiding === donor.id ? (
                    <div className="cf-form cf-update-form">
                      <label>
                        Alasan menyembunyikan doa (privat)
                        <input
                          value={reason}
                          maxLength={1000}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <div className="cf-actions">
                        <button
                          className="cf-button cf-danger"
                          disabled={busy || !reason.trim()}
                          onClick={() => void hide(donor)}
                        >
                          Sembunyikan doa
                        </button>
                        <button
                          className="cf-text-button"
                          onClick={() => setHiding(undefined)}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="cf-text-button"
                      onClick={() => {
                        setHiding(donor.id);
                        setReason("");
                      }}
                    >
                      Sembunyikan doa ini
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      {page && page.donors.length < page.total && (
        <button
          className="cf-button cf-secondary"
          disabled={busy}
          onClick={() => void load(page.donors.length)}
        >
          {busy
            ? "Memuat…"
            : `Lihat ${Math.min(PAGE, page.total - page.donors.length)} donatur berikutnya`}
        </button>
      )}
    </section>
  );
}
