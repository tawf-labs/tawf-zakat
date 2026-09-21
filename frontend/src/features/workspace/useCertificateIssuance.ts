import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { createCertificateTask, type CertificatePorts } from "./certificateInteraction";
import type { PrivateRequests } from "./privateRequests";

type Subject = { institutionId: string; activityId: string; certificateId: string; requests: PrivateRequests };

export function useCertificateIssuance(subject: Subject) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const signer = useRef(signTypedDataAsync);
  signer.current = signTypedDataAsync;
  const task = useMemo(
    () =>
      createCertificateTask({
        ...subject,
        account: address,
        chainId,
        sign: (payload) => signer.current(payload),
        now: () => Math.floor(Date.now() / 1000),
        schedule: (run, delay) => {
          const timer = setTimeout(run, delay);
          return () => clearTimeout(timer);
        },
      }),
    [subject.requests, subject.institutionId, subject.activityId, subject.certificateId, address, chainId],
  );
  useLayoutEffect(() => {
    void task.start();
    return () => task.dispose();
  }, [task]);
  const state = useSyncExternalStore(task.subscribe, task.getSnapshot, task.getSnapshot);
  return { ...state, task };
}
export type { CertificatePorts };
