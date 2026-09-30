import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrivateRequests } from "./privateRequests";
import type { Workspace } from "./workspaceClient";
import { Award, ShieldCheck, Users } from "lucide-react";
import { OfficerMandatesCard } from "./OfficerMandatesCard";
import { EndorsementSignerSelector } from "./EndorsementSignerSelector";
import { OfficerManagementSection } from "./OfficerManagementSection";
import { MandateManagementSection } from "./MandateManagementSection";
import { EndorsementAccountSection } from "./EndorsementAccountSection";
import { useAuthorityOfficers, useEndorsements, useMandates } from "./useAuthorityManagement";

function AuthorityMetricsSummary({ requests }: { requests: PrivateRequests }) {
  const officers = useAuthorityOfficers(requests);
  const mandates = useMandates(requests);
  const endorsements = useEndorsements(requests);

  const activeOfficers = officers.data?.filter(o => o.isActive).length ?? 0;
  const totalAccounts = officers.data?.reduce((acc, o) => acc + o.accounts.filter(a => a.isActive).length, 0) ?? 0;
  const activeMandates = mandates.data?.filter(m => m.isActive).length ?? 0;
  const activeEndorsements = endorsements.data?.filter(e => e.isActive).length ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="rounded-2xl border border-stone-200/90 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Petugas Operasional</span>
          <div className="rounded-xl bg-emerald-50 p-2 text-[#1b765e] border border-emerald-100">
            <Users className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 text-2xl font-bold text-[#17332c]">{activeOfficers} <span className="text-xs font-normal text-stone-500">aktif</span></div>
        <span className="mt-1 block text-xs text-stone-500">{totalAccounts} akun dompet kerja tertaut</span>
      </div>

      <div className="rounded-2xl border border-stone-200/90 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Mandat SK Lembaga</span>
          <div className="rounded-xl bg-emerald-50 p-2 text-[#1b765e] border border-emerald-100">
            <Award className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 text-2xl font-bold text-[#17332c]">{activeMandates} <span className="text-xs font-normal text-stone-500">berlaku</span></div>
        <span className="mt-1 block text-xs text-stone-500">Kewenangan operasional & plafon dana</span>
      </div>

      <div className="rounded-2xl border border-stone-200/90 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Akun Pengesahan</span>
          <div className="rounded-xl bg-emerald-50 p-2 text-[#1b765e] border border-emerald-100">
            <ShieldCheck className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 text-2xl font-bold text-[#17332c]">{activeEndorsements} <span className="text-xs font-normal text-stone-500">terdaftar</span></div>
        <span className="mt-1 block text-xs text-stone-500">Penanda tangan institusi resmi</span>
      </div>
    </div>
  );
}

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
      <AuthorityMetricsSummary requests={requests} />
      <OfficerManagementSection requests={requests} />
      <MandateManagementSection requests={requests} />
      <EndorsementAccountSection requests={requests} />
    </>}
  </QueryClientProvider>;
}
