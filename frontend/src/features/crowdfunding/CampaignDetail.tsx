import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  api,
  categories,
  money,
  readable,
  safePaymentUrl,
  statusLabel,
  type Campaign,
} from "./client";
import { CampaignCover, CampaignProgress, Notice } from "./PublicCampaigns";
import { useCampaignPayment } from "./useCampaignPayment";

export function ChainEvidence({ campaign }: { campaign: Campaign }) {
  const labels: Record<string, string> = {
    PENDING: "Menunggu pencatatan blockchain",
    CONFIRMED: "Pencatatan blockchain dikonfirmasi",
    UNCONFIGURED: "Blockchain belum dikonfigurasi",
    FAILED: "Pencatatan blockchain gagal",
  };
  return (
    <section className="cf-evidence">
      <span className="cf-eyebrow">JEJAK BUKTI</span>
      <h3>
        {labels[campaign.chainStatus] || "Status blockchain belum tersedia"}
      </h3>
      {campaign.chainTxHash && (
        <p className="cf-hash">
          Hash transaksi: <code>{campaign.chainTxHash}</code>
        </p>
      )}
      <p>
        Pencatatan membuktikan jejak data, bukan kebenaran seluruh klaim, izin
        penghimpunan, atau penerimaan dana oleh penerima manfaat.
      </p>
    </section>
  );
}
export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [campaign, setCampaign] = useState<Campaign>();
  const [error, setError] = useState("");
  const {
    payment,
    busy,
    error: paymentError,
    create,
    check,
    retry: retryCheckout,
  } = useCampaignPayment(campaignId);
  const [amount, setAmount] = useState(50000);
  const [donorName, setDonorName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const load = useCallback(
    () =>
      api<{ campaign: Campaign }>(
        `/campaigns/${encodeURIComponent(campaignId)}`,
        { public: true },
      )
        .then((data) => {
          if (!active.current) return;
          setCampaign(data.campaign);
          setError("");
        })
        .catch((e) => {
          if (active.current) setError(e.message);
        }),
    [campaignId],
  );
  useEffect(() => {
    setCampaign(undefined);
    void load();
  }, [load]);
  const checkPayment = useCallback(async () => {
    if ((await check()) && active.current) await load();
  }, [check, load]);
  useEffect(() => {
    if (
      !payment?.accessToken ||
      [
        "PAID",
        "SETTLEMENT",
        "EXPIRED",
        "FAILED",
        "CANCELLED",
        "DENIED",
        "REFUNDED",
      ].includes(payment.status.toUpperCase())
    )
      return;
    const timer = window.setInterval(() => {
      void checkPayment();
    }, 10000);
    return () => clearInterval(timer);
  }, [payment, checkPayment]);
  async function donate(event: React.FormEvent) {
    event.preventDefault();
    await create({
      amount,
      donorName: donorName.trim() || (anonymous ? "Anonim" : ""),
      isAnonymous: anonymous,
    });
  }
  return (
    <main className="cf cf-page" id="main-content">
      <div className="cf-container">
        <Link to="/kampanye" className="cf-back">
          ← Semua kampanye
        </Link>
        {error ? (
          <Notice error>
            {error}{" "}
            <button className="cf-text-button" onClick={() => void load()}>
              Coba lagi
            </button>
          </Notice>
        ) : !campaign ? (
          <Notice>Memuat cerita kampanye…</Notice>
        ) : (
          <>
            <div className="cf-detail-heading">
              <span className="cf-eyebrow">
                {categories[campaign.category]} ·{" "}
                {statusLabel[campaign.status] || campaign.status}
              </span>
              <h1>{campaign.title}</h1>
              <p>{campaign.summary}</p>
            </div>
            <div className="cf-detail-grid">
              <article>
                <CampaignCover campaign={campaign} />
                <section className="cf-panel">
                  <span className="cf-eyebrow">PENGGALANG DANA</span>
                  <h3>
                    {campaign.organizer.organizationName ||
                      campaign.organizer.name}
                  </h3>
                  <p>
                    {campaign.organizer.kind === "ORGANIZATION"
                      ? "Organisasi"
                      : "Individu"}{" "}
                    · Pengajuan versi {campaign.version}
                  </p>
                </section>
                <section className="cf-panel">
                  <h2>Cerita di balik harapan</h2>
                  <p className="cf-preline">{campaign.story}</p>
                </section>
                <ChainEvidence campaign={campaign} />
                <section className="cf-panel">
                  <h2>Kabar & perkembangan</h2>
                  {campaign.updates?.length ? (
                    campaign.updates.map((update, index) => (
                      <p className="cf-preline" key={index}>
                        {readable(update)}
                      </p>
                    ))
                  ) : (
                    <p>
                      Belum ada pembaruan yang dipublikasikan. Belum ada
                      informasi penyaluran yang dapat ditampilkan.
                    </p>
                  )}
                </section>
              </article>
              <aside>
                <div className="cf-donation cf-panel">
                  <span className="cf-badge">
                    PEMBAYARAN RESMI & TERVERIFIKASI
                  </span>
                  <CampaignProgress campaign={campaign} />
                  <p className="cf-small">
                    Berakhir{" "}
                    {new Date(campaign.endsAt).toLocaleDateString("id-ID", {
                      dateStyle: "long",
                    })}
                    . Terkumpul ≠ tersalurkan.
                  </p>
                  {campaign.status === "PUBLISHED" &&
                  new Date(campaign.endsAt).getTime() > Date.now() ? (
                    <form onSubmit={donate} className="cf-form">
                      <h2>Ambil bagian dalam kebaikan</h2>
                      <div className="cf-presets">
                        {[25000, 50000, 100000].map((value) => (
                          <button
                            type="button"
                            className={amount === value ? "active" : ""}
                            key={value}
                            onClick={() => setAmount(value)}
                          >
                            {money(value)}
                          </button>
                        ))}
                      </div>
                      <label>
                        Nominal donasi (Rp)
                        <input
                          type="number"
                          required
                          min="1000"
                          max="1000000000"
                          step="1"
                          value={amount}
                          onChange={(e) => setAmount(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Nama donatur
                        <input
                          value={donorName}
                          maxLength={100}
                          required={!anonymous}
                          onChange={(e) => setDonorName(e.target.value)}
                          placeholder="Nama Anda"
                        />
                      </label>
                      <label className="cf-checkbox">
                        <input
                          type="checkbox"
                          checked={anonymous}
                          onChange={(e) => setAnonymous(e.target.checked)}
                        />{" "}
                        Tampilkan sebagai anonim
                      </label>
                      <button
                        className="cf-button"
                        disabled={
                          busy ||
                          Boolean(
                            payment &&
                            [
                              "PENDING",
                              "CREATED",
                              "CREATING",
                              "GATEWAY_ERROR",
                              "NOT_FOUND",
                            ].includes(payment.status.toUpperCase()),
                          )
                        }
                      >
                        {busy
                          ? "Menyiapkan pembayaran…"
                          : "Lanjut ke pembayaran"}
                      </button>
                      <p className="cf-small">
                        Tidak perlu akun atau wallet. Konfirmasi pembayaran
                        hanya berasal dari server, bukan dari tombol di browser.
                      </p>
                    </form>
                  ) : (
                    <Notice>
                      Kampanye ini tidak menerima donasi saat ini.
                    </Notice>
                  )}
                  {paymentError && <Notice error>{paymentError}</Notice>}
                  {payment && (
                    <section className="cf-payment" aria-live="polite">
                      <h3>Pembayaran Anda</h3>
                      <p>
                        {money(payment.amount)} ·{" "}
                        <strong>{payment.status}</strong>
                      </p>
                      {["GATEWAY_ERROR", "CREATING", "NOT_FOUND"].includes(
                        payment.status.toUpperCase(),
                      ) &&
                        payment.accessToken && (
                          <>
                            <button
                              type="button"
                              className="cf-button cf-secondary"
                              disabled={busy}
                              onClick={() => void retryCheckout()}
                            >
                              {busy
                                ? "Mencoba checkout…"
                                : "Coba lagi checkout yang sama"}
                            </button>
                            <p className="cf-small">
                              Menggunakan ID pembayaran yang sama, bukan membuat
                              donasi baru. Pembayaran belum dikonfirmasi.
                            </p>
                          </>
                        )}
                      {safePaymentUrl(payment.redirectUrl) ? (
                        <a
                          className="cf-button"
                          href={safePaymentUrl(payment.redirectUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Buka Pembayaran Midtrans ↗
                        </a>
                      ) : (
                        <p>
                          Tautan pembayaran belum tersedia. Periksa status sebelum
                          membuat pembayaran lain.
                        </p>
                      )}
                      <button
                        type="button"
                        className="cf-text-button"
                        onClick={() => void checkPayment()}
                      >
                        Periksa status pembayaran
                      </button>
                      <p className="cf-small">
                        Akses pembayaran disimpan untuk tab ini. Status
                        diperiksa berkala selama menunggu; tidak ada klaim dana
                        telah tersalurkan.
                      </p>
                    </section>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
