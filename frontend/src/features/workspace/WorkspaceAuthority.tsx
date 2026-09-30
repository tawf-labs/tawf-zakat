import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrivateRequests } from "./privateRequests";
import type { Workspace } from "./workspaceClient";
import { OfficerMandatesCard } from "./OfficerMandatesCard";
import { EndorsementSignerSelector } from "./EndorsementSignerSelector";
import { OfficerManagementSection } from "./OfficerManagementSection";
import { MandateManagementSection } from "./MandateManagementSection";
import { EndorsementAccountSection } from "./EndorsementAccountSection";

/** The parent keys this private cache and all form/selection state by session context. */
export function WorkspaceAuthority({ requests, workspace, view = "identity" }: { requests: PrivateRequests; workspace: Workspace; view?: "identity" | "management" }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>
    {view === "identity" && <>
      <OfficerMandatesCard mandates={workspace.mandates} officerName={workspace.officer?.displayName} />
      <EndorsementSignerSelector operatorAccount={workspace.account} officerProfile={workspace.officer} endorsementAccounts={workspace.endorsementAccounts} />
    </>}
    {view === "management" && workspace.capabilities.manageMembers && <>
      <OfficerManagementSection requests={requests} />
      <MandateManagementSection requests={requests} />
      <EndorsementAccountSection requests={requests} />
    </>}
  </QueryClientProvider>;
}
