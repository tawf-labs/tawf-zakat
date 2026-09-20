import { useState } from "react";
import { Button } from "../../components/ui/Button";

export function BatchEndorsementForm({ busy, submitting, previouslyEndorsed, onEndorse }: {
  busy: boolean; submitting: boolean; previouslyEndorsed: boolean; onEndorse: () => Promise<void>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return <>
    <label className="flex gap-2"><input type="checkbox" checked={acknowledged} disabled={busy}
      onChange={e => setAcknowledged(e.target.checked)} />Saya telah memeriksa populasi dan cutoff snapshot ini.</label>
    <Button disabled={busy || !acknowledged} onClick={() => void onEndorse()}>
      {submitting ? "Mengesahkan…" : previouslyEndorsed ? "Sahkan ulang snapshot" : "Sahkan snapshot dan proses otomatis"}
    </Button>
  </>;
}
