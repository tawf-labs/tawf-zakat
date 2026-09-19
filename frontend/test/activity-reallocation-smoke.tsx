/**
 * Browser smoke for Issue #107: the real activity detail modal, reading availability
 * from the live API, and the reallocation modal it opens. The components are the ones
 * the workspace renders; only the route that reaches them is shortened.
 */
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ActivityDetailModal } from "../src/features/activities/ActivityDetailModal";
import { createWorkspaceAccess } from "../src/features/workspace/workspaceAccessController";

const bootstrap = await (await fetch("/bootstrap")).json();
const access = createWorkspaceAccess({
  origin: location.origin,
  fetch: window.fetch.bind(window),
  storage: sessionStorage,
  now: () => bootstrap.now,
  sign: async (payload) =>
    (
      await (
        await fetch("/sign", {
          method: "POST",
          body: JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
        })
      ).json()
    ).signature,
  schedule: (task, ms) => {
    const id = setTimeout(task, ms);
    return () => clearTimeout(id);
  },
});
await access.connect(bootstrap.account);
if (access.getSnapshot().state !== "READY") await access.enter(bootstrap.institutionId);

function Smoke() {
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const [activityId, setActivityId] = useState<string>(bootstrap.sourceActivityId);
  const [open, setOpen] = useState(false);
  if (state.state !== "READY") return <p>Akun berganti{state.error ? `: ${state.error}` : ""}</p>;
  return (
    <>
      <button onClick={() => { setActivityId(bootstrap.sourceActivityId); setOpen(true); }}>
        Buka kegiatan sumber
      </button>
      <button onClick={() => { setActivityId(bootstrap.targetActivityId); setOpen(true); }}>
        Buka kegiatan tujuan
      </button>
      {open && (
        <ActivityDetailModal
          key={`${state.requests.contextId}:${activityId}`}
          activityId={activityId}
          requests={state.requests}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Smoke />);
