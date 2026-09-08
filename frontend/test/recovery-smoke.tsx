import { createRoot } from "react-dom/client";
import { RecoveryPanel } from "../src/features/workspace/RecoveryPanel";
const props = await (await fetch("/smoke-config")).json();
createRoot(document.getElementById("root")!).render(<RecoveryPanel {...props} />);
