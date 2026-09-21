import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { DonorAccessPanel } from "../src/features/donor/DonorAccessPanel";

// Exercise the actual session owner, OTP form and per-session cache, not a pre-authenticated child.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <DonorAccessPanel reference="contribution-session-test" />
  </QueryClientProvider>,
);
