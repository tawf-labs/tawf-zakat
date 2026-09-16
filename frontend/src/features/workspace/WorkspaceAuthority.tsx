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
export function WorkspaceAuthority({ requests, workspace }: { requests: PrivateRequests; workspace: Workspace }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>
    <OfficerMandatesCard mandates={workspace.mandates} officerName={workspace.officer?.displayName} />
    <EndorsementSignerSelector operatorAccount={workspace.account} officerProfile={workspace.officer} endorsementAccounts={workspace.endorsementAccounts} />
    {workspace.capabilities.manageMembers && <>
      <OfficerManagementSection requests={requests} />
      <MandateManagementSection requests={requests} />
      <EndorsementAccountSection requests={requests} />
    </>}
  </QueryClientProvider>;
}
