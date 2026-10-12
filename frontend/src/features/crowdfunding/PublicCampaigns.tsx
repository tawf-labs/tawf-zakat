import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  HeartHandshake,
  Sprout,
  FileCheck2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api, categories, money, statusLabel, type Campaign } from "./client";
import "./crowdfunding.css";

export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`cf-notice ${error ? "cf-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function CampaignCover({ campaign }: { campaign: Campaign }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`cf-cover cf-cover-${campaign.category.toLowerCase()}`}>
      {campaign.coverImageUrl &&
      /^https:\/\//.test(campaign.coverImageUrl) &&
      !failed ? (
        <img
          src={campaign.coverImageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <HeartHandshake size={68} strokeWidth={1} />
          <span>{categories[campaign.category] || "Kebaikan bersama"}</span>
        </>
      )}
    </div>
  );
}
export function CampaignProgress({ campaign }: { campaign: Campaign }) {
  const progress =
    campaign.targetAmount > 0
      ? Math.min(100, (campaign.collectedAmount / campaign.targetAmount) * 100)
      : 0;
  return (
    <div className="cf-progress-block">
      <div className="cf-amount">
        {money(campaign.collectedAmount)} <span>terkumpul</span>
      </div>
      <progress
        max="100"
        value={progress}
        aria-label="Persentase target terkumpul"
      />
      <div className="cf-meta">
        <span>Target {money(campaign.targetAmount)}</span>
        <span>{campaign.donationCount} donasi</span>
      </div>
    </div>
  );
}
export function CrowdfundingHome({
  initialCategory,
}: {
  initialCategory?: string;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState(
    initialCategory && initialCategory in categories ? initialCategory : "ALL",
  );
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<{ campaigns: Campaign[] }>("/campaigns", { public: true })
      .then((data) => {
        if (active) setCampaigns(data.campaigns);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const visible = campaigns.filter(
    (c) =>
      (category === "ALL" || c.category === category) &&
      `${c.title} ${c.organizer.name} ${c.organizer.organizationName || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <main className="cf" id="main-content">
      <section className="cf-hero">
        <div className="cf-container cf-hero-grid">
          <div>
            <span className="cf-eyebrow">
              <span /> KEBAIKAN DIMULAI DARI KITA
            </span>
            <h1>
              Satu niat baik.
              <br />
              <em>Banyak harapan baru.</em>
            </h1>
            <p>
              Bersama, bantu cerita baik terus berjalan. Temukan kampanye dari
              individu dan organisasi, kenali kebutuhannya, dan ikuti
              perkembangannya.
            </p>
            <div className="cf-actions">
              <a className="cf-button" href="#kampanye">
                Temukan kampanye <ArrowUpRight size={18} />
              </a>
              <Link to="/galang-dana" className="cf-button cf-secondary">
                Mulai galang dana
              </Link>
            </div>
            <div className="cf-hero-note">
              <HeartHandshake size={18} /> Donasi tanpa wallet · Pembayaran
              online instan
            </div>
          </div>
          <div className="cf-hero-art" aria-hidden="true">
            <div className="cf-orbit" />
            <Sprout className="cf-sprout" size={150} strokeWidth={1} />
            <div className="cf-art-label">
              <span>RUANG UNTUK SALING PEDULI</span>
              <strong>
                Kecil langkahnya.
                <br />
                Besar artinya.
              </strong>
            </div>
            <span className="cf-art-stamp">
              TUMBUH
              <br />
              BERSAMA
            </span>
          </div>
        </div>
      </section>
      <div className="cf-container">
        <div className="cf-trust">
          <span>
            <FileCheck2 size={20} /> Pengajuan melalui review
          </span>
          <span>
            <HeartHandshake size={20} /> Individu & organisasi
          </span>
          <span>
            <ShieldCheck size={20} /> Status bukti dapat ditelusuri
          </span>
        </div>
        <section className="cf-section" id="kampanye">
          <div className="cf-section-heading">
            <div>
              <span className="cf-eyebrow">TEMUKAN YANG BERARTI</span>
              <h2>Harapan yang bisa kita bantu.</h2>
            </div>
            <label className="cf-search">
              <Search size={18} />
              <input
                aria-label="Cari kampanye atau penggalang"
                placeholder="Cari kampanye atau penggalang"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <div className="cf-filters" aria-label="Kategori kampanye">
            {Object.entries({ ALL: "Semua kampanye", ...categories }).map(
              ([key, label]) => (
                <button
                  key={key}
                  className={category === key ? "active" : ""}
                  aria-pressed={category === key}
                  onClick={() => setCategory(key)}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          {loading ? (
            <Notice>Memuat kampanye dari layanan…</Notice>
          ) : error ? (
            <Notice error>
              {error}{" "}
              <button
                className="cf-text-button"
                onClick={() => setRetry((v) => v + 1)}
              >
                Coba lagi
              </button>
            </Notice>
          ) : visible.length === 0 ? (
            <div className="cf-empty">
              <Sprout size={40} />
              <h3>
                {campaigns.length
                  ? "Belum ada hasil yang sesuai"
                  : "Cerita baik berikutnya sedang dipersiapkan"}
              </h3>
              <p>
                {campaigns.length
                  ? "Coba kata kunci atau kategori lain."
                  : "Kampanye akan tampil setelah selesai ditinjau dan diterbitkan."}
              </p>
              <Link to="/galang-dana" className="cf-button cf-secondary">
                Ajukan kampanye pertama
              </Link>
            </div>
          ) : (
            <div className="cf-cards">
              {visible.map((c) => (
                <Link
                  to="/kampanye/$campaignId"
                  params={{ campaignId: c.id }}
                  className="cf-card"
                  key={c.id}
                >
                  <CampaignCover campaign={c} />
                  <div className="cf-card-body">
                    <span className="cf-eyebrow">
                      {categories[c.category]} ·{" "}
                      {statusLabel[c.status] || c.status}
                    </span>
                    <h3>{c.title}</h3>
                    <p className="cf-organizer">
                      Oleh {c.organizer.organizationName || c.organizer.name} ·{" "}
                      {c.organizer.kind === "ORGANIZATION"
                        ? "Organisasi"
                        : "Individu"}
                    </p>
                    <p>{c.summary}</p>
                    <CampaignProgress campaign={c} />
                    <span className="cf-card-link">
                      Lihat cerita & bantu <ArrowUpRight size={17} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="cf-how">
          <div>
            <span className="cf-eyebrow">NIAT BAIK, LANGKAH YANG JELAS</span>
            <h2>
              Dari kepedulian,
              <br />
              menjadi gerakan.
            </h2>
            <p>
              Pengajuan terbuka untuk individu dan organisasi. Setiap kampanye
              melewati review sebelum tampil ke publik.
            </p>
          </div>
          <ol>
            {[
              [
                "Ceritakan kebutuhan",
                "Buat akun, susun proposal, dan sertakan dokumen pendukung privat.",
              ],
              [
                "Tinjau bersama",
                "Operator memeriksa kebutuhan, persetujuan, anggaran, dan rencana distribusi.",
              ],
              [
                "Bagikan harapan",
                "Setelah diterbitkan, kampanye siap menerima donasi secara online.",
              ],
            ].map(([title, text], i) => (
              <li key={title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
