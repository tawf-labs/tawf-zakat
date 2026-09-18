import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ProposalBeneficiaryListModal } from "../src/features/disbursement/ProposalBeneficiaryListModal";
import { RevisionWorkflowBanner } from "../src/features/disbursement/RevisionWorkflowBanner";
import { createWorkspaceAccess } from "../src/features/workspace/workspaceAccessController";
import type { ProposalDraft } from "../src/features/disbursement/disbursementClient";

const bootstrap = await (await fetch("/bootstrap")).json();
const access = createWorkspaceAccess({ origin: location.origin, fetch: window.fetch.bind(window), storage: sessionStorage,
  now: () => bootstrap.now,
  sign: async payload => (await (await fetch("/sign", { method: "POST", body: JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? value.toString() : value) })).json()).signature,
  schedule: (task, ms) => { const id = setTimeout(task, ms); return () => clearTimeout(id); },
});
await access.connect(bootstrap.account);
if (access.getSnapshot().state !== "READY") await access.enter(bootstrap.institutionId);
function Smoke() {
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const [draft, setDraft] = useState<ProposalDraft>(bootstrap.draft);
  const [open, setOpen] = useState(false);
  if (state.state !== "READY") return <p>Akun berganti{state.error ? `: ${state.error}` : ""}</p>;
  const { requests } = state;
  return (
    <>
      <button onClick={() => setOpen(true)}>
        Perbarui daftar penerima dari berkas
      </button>
      <button onClick={() => void access.connect(bootstrap.otherAccount)}>
        Ganti akun
      </button>
      <p>Versi tersimpan: {draft.version}</p>
      <RevisionWorkflowBanner
        requests={requests}
        proposal={draft}
        onDraftUpdated={setDraft}
      />
      {open && (
        <ProposalBeneficiaryListModal
          key={requests.contextId}
          requests={requests}
          proposal={draft}
          isOpen
          onClose={() => setOpen(false)}
          onAppliedDraft={setDraft}
          onAppliedRevision={(_revision, saved) => setDraft(saved)}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Smoke />);
