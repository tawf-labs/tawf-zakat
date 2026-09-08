import { createRoot } from "react-dom/client";
import { PublicReport } from "../src/features/reports/PublicReport";
createRoot(document.getElementById("root")!).render(<PublicReport packageId={new URLSearchParams(location.search).get("packageId") ?? ""} />);
