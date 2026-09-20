import { createRoot } from "react-dom/client";
import { ContributionBatches } from "../src/features/contributions/ContributionBatches";
import { createPrivateRequests } from "../src/features/workspace/privateRequests";
const requests = createPrivateRequests({ origin: location.origin, token: sessionStorage.getItem("workspace-test-token")!,
  contextId: "batch-smoke", fetch: (url, init) => fetch(url, init), assertCurrent() {}, denied() {} });
createRoot(document.getElementById("root")!).render(<main className="max-w-3xl mx-auto p-4"><ContributionBatches requests={requests} /></main>);
