import { createRoot } from "react-dom/client";
import { SearchReceiptForm } from "../src/features/verification/SearchReceiptForm";

const searchParams = new URLSearchParams(window.location.search);
const initialTrxId = searchParams.get("trxId") ?? "";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<SearchReceiptForm initialTrxId={initialTrxId} />);
}
