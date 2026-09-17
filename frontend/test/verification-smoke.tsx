import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SearchReceiptForm } from "../src/features/verification/SearchReceiptForm";

const initialTrxId = new URLSearchParams(window.location.search).get("trxId") ?? "";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <SearchReceiptForm initialTrxId={initialTrxId} />
  </QueryClientProvider>,
);
