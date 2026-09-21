import { useState } from "react";
import { Button } from "../../components/ui/Button";

export function BatchEndorsementForm({ busy, submitting, previouslyEndorsed, onEndorse }: {
  busy: boolean; submitting: boolean; previouslyEndorsed: boolean; onEndorse: () => Promise<void>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return <>
    <label className="flex gap-2"><input type="checkbox" checked={acknowledged} disabled={busy}
      onChange={e => setAcknowledged(e.target.checked)} />Saya sudah memeriksa daftar kontribusi dan batas waktu penerimaan ini.</label>
    <Button disabled={busy || !acknowledged} onClick={() => void onEndorse()}>
      {submitting ? "Mengesahkan…" : previouslyEndorsed ? "Sahkan ulang daftar ini" : "Sahkan daftar dan proses otomatis"}
    </Button>
  </>;
}
