import { fixtureAccess, FixtureAccess } from "./access-fixture";
import { createRoot } from "react-dom/client";
import { RecoveryPanel } from "../src/features/workspace/RecoveryPanel";
const props = await (await fetch("/smoke-config")).json();
const access = await fixtureAccess(props.token);
createRoot(document.getElementById("root")!).render(<FixtureAccess access={access}>{requests => <RecoveryPanel {...props} requests={requests} />}</FixtureAccess>);
