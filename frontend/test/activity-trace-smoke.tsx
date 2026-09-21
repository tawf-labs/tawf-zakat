/**
 * Browser smoke for Issue #114: the donor's trace section and the amil's recap panel, the same
 * components the pages render, reading the live API. Only the route that reaches them is shortened.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { DonorTraceSection } from "../src/features/donor/DonorTraceSection";
import { ActivityTracePanel } from "../src/features/activities/ActivityTracePanel";
import { FixtureAccess, fixtureAccess } from "./access-fixture";

const bootstrap = await (await fetch("/bootstrap")).json();
const access = await fixtureAccess(bootstrap.workspaceToken);
const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queries}>
    <main>
      <div data-testid="donor">
        <DonorTraceSection session={bootstrap.donorSession} />
      </div>
      <div data-testid="amil">
        <FixtureAccess access={access}>
          {(requests) => <ActivityTracePanel activityId={bootstrap.activityId} requests={requests} reloadKey={0} />}
        </FixtureAccess>
      </div>
    </main>
  </QueryClientProvider>,
);
