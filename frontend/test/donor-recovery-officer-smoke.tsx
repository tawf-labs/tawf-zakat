import { createRoot } from "react-dom/client";
import { fixtureAccess, FixtureAccess } from "./access-fixture";
import { ContributionPanel } from "../src/features/contributions/ContributionPanel";

const { token } = await (await fetch("/smoke-config")).json();
const access = await fixtureAccess(token);
createRoot(document.getElementById("root")!).render(
  <FixtureAccess access={access}>{requests => <ContributionPanel requests={requests} canManage />}</FixtureAccess>,
);
