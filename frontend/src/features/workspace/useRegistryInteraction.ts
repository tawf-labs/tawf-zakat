import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { createAttestationTask, createPublicationTask, createRecordingTask, type InteractionPorts } from "./registryInteraction";
import type { PrivateRequests } from "./privateRequests";
import type { SavedReportPackage } from "./evidenceClient";

type Subject = { saved: SavedReportPackage; preparationId: string; requests: PrivateRequests };
function useTask<T extends ReturnType<typeof createRecordingTask> | ReturnType<typeof createAttestationTask>>(factory: (ports: InteractionPorts) => T, subject: Subject) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const signer = useRef(signTypedDataAsync); signer.current = signTypedDataAsync;
  const task = useMemo(() => factory({ ...subject, account: address, chainId,
    sign: payload => signer.current(payload), now: () => Math.floor(Date.now() / 1000),
    storage: { getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value), removeItem: key => sessionStorage.removeItem(key) },
    schedule: (run, delay) => { const timer = setTimeout(run, delay); return () => clearTimeout(timer); },
  }), [factory, subject.requests, subject.preparationId, subject.saved.id, subject.saved.digest, address, chainId]);
  useLayoutEffect(() => { void task.start(); return () => task.dispose(); }, [task]);
  const state = useSyncExternalStore<ReturnType<T["getSnapshot"]>>(task.subscribe, task.getSnapshot as () => ReturnType<T["getSnapshot"]>, task.getSnapshot as () => ReturnType<T["getSnapshot"]>);
  return { ...state, task };
}
export const useRecording = (subject: Subject) => useTask(createRecordingTask, subject);
export const usePublication = (subject: Subject) => useTask(createPublicationTask, subject);
export const useAttestation = (subject: Subject) => useTask(createAttestationTask, subject);
