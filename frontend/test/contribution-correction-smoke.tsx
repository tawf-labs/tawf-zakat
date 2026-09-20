import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContributionBatches } from "../src/features/contributions/ContributionBatches";
import { PublicReceiptProof } from "../src/features/verification/PublicReceiptProof";
import { createPrivateRequests } from "../src/features/workspace/privateRequests";

const requests = createPrivateRequests({ origin: location.origin, token: sessionStorage.getItem("workspace-test-token")!,
  contextId: "correction-smoke", fetch: (url, init) => fetch(url, init), assertCurrent() {}, denied() {} });
const reference = new URLSearchParams(location.search).get("reference")!;
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}>
  <main className="max-w-3xl mx-auto p-4">
    <PublicReceiptProof reference={reference} />
    <ContributionBatches requests={requests} />
  </main>
</QueryClientProvider>);
