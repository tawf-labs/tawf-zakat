import { useEffect, useState } from "react";
import { campaignCoverSrc, sessionToken, type Campaign } from "./client";

/** Cover preview and upload for the owner. A draft cover is private, so the preview is fetched with the session. */
export function CampaignCoverUpload({
  campaign,
  editable,
  busy,
  onUpload,
}: {
  campaign: Campaign;
  editable: boolean;
  busy: boolean;
  onUpload: (file?: File) => void;
}) {
  const src = campaignCoverSrc(campaign);
  const uploaded = Boolean(campaign.coverImageId);
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!src) return setPreview(undefined);
    if (!uploaded) return setPreview(src);
    let active = true;
    let url: string | undefined;
    fetch(src, { headers: { Authorization: `Bearer ${sessionToken()}` } })
      .then((response) => (response.ok ? response.blob() : undefined))
      .then((blob) => {
        if (!blob || !active) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, uploaded]);
  if (!editable && !src) return null;
  return (
    <section className="cf-panel cf-form">
      <h2>Foto sampul</h2>
      {preview ? (
        <img
          className="cf-cover-preview"
          src={preview}
          alt="Foto sampul kampanye"
        />
      ) : (
        <p>
          Belum ada foto sampul. Kampanye dengan foto lebih mudah dipercaya dan
          dibagikan.
        </p>
      )}
      {editable && (
        <label>
          {src ? "Ganti foto sampul" : "Unggah foto sampul"} (JPEG atau PNG ·
          maks. 2 MB)
          <input
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy}
            onChange={(e) => {
              onUpload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {editable && (
        <p className="cf-small">
          Foto tampil ke publik setelah kampanye diperiksa dan diterbitkan.
          Pastikan Anda berhak memakainya dan tidak menampilkan wajah atau
          identitas penerima manfaat tanpa persetujuan.
        </p>
      )}
    </section>
  );
}
