import { useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  clearDonorSession,
  endDonorSession,
  nowInSeconds,
  readDonorSession,
  saveDonorSession,
  type DonorSessionRecord,
} from "./donorClient";
import { DonorOtpAccess } from "./DonorOtpAccess";
import { DonorContributionView } from "./DonorContributionView";

/**
 * Donor access for one searched reference. The parent keys this component by
 * the reference, so a new search starts from storage for that reference and
 * never pairs an old session with a new record.
 */
export function DonorAccessPanel({ reference }: { reference: string }) {
  const [session, setSession] = useState<DonorSessionRecord | null>(() => readDonorSession(reference));
  const [endedNotice, setEndedNotice] = useState<string | null>(null);

  const forget = useCallback(
    (notice: string | null) => {
      clearDonorSession(reference);
      setSession(null);
      setEndedNotice(notice);
    },
    [reference]
  );

  // The page does not wait for a request to discover expiry: private detail
  // leaves the screen when the session's own deadline passes.
  useEffect(() => {
    if (!session) return;
    const remainingMs = (session.expiresAt - nowInSeconds()) * 1000;
    const timer = setTimeout(
      () => forget("Sesi donatur telah berakhir. Verifikasi ulang dengan kode OTP untuk membuka rincian."),
      Math.max(0, remainingMs)
    );
    return () => clearTimeout(timer);
  }, [session, forget]);

  if (!session) {
    return (
      <DonorOtpAccess
        reference={reference}
        notice={endedNotice}
        onAuthenticated={(record) => {
          saveDonorSession(reference, record);
          setEndedNotice(null);
          setSession(record);
        }}
      />
    );
  }

  return (
    <DonorSessionScope key={session.token}>
      <DonorContributionView
        session={session}
        onLogout={() => {
          void endDonorSession(session.token);
          forget(null);
        }}
        onSessionEnded={forget}
      />
    </DonorSessionScope>
  );
}

/** One private cache per session, dropped with it. */
function DonorSessionScope({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
