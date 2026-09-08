import { withRegistryRead } from "./registry-read";
import { createExamination } from "./report-examination";
import { createRecording } from "./registry-recording";
import type { WorkspaceRuntime } from "./workspace-runtime";

/** Read projections share a reference, but never write recovery/relay checkpoints. */
export function createReportVersions(runtime: WorkspaceRuntime, institution: string, preparation: string, packageId: string) {
  async function read<T>(project: (scoped: WorkspaceRuntime) => Promise<T>) {
    if (!runtime.registry) throw new Error("Registry unavailable");
    const registry = runtime.registry;
    const once = <T extends (...args: any[]) => Promise<any>>(fn: T): T => {
      const values = new Map<string, Promise<any>>();
      return ((...args: any[]) => {
        const key = JSON.stringify(args);
        if (!values.has(key)) values.set(key, fn(...args));
        return values.get(key)!;
      }) as T;
    };
    const pending = new Map<string, unknown>();
    const evidence = runtime.evidence!;
    const result = await withRegistryRead(registry.chain, chain => project({ ...runtime,
      evidence: { ...evidence, savePublicReport: async (id, content) => { pending.set(id, content); },
        getPublicReport: async id => pending.has(id) ? pending.get(id) : evidence.getPublicReport(id) },
      registry: { ...registry, chain,
      store: { ...registry.store, list: once(registry.store.list), get: once(registry.store.get), attempt: once(registry.store.attempt), observe: async (intent, observation, transactionHash) => ({ ...intent, observation, transactionHash }) },
    } }));
    let differentWinner = false;
    for (const [id, content] of pending) {
      await evidence.savePublicReport(id, content);
      const persisted = await evidence.getPublicReport(id);
      if (!persisted) throw new Error("Ringkasan publik belum tersimpan.");
      if (JSON.stringify(persisted) !== JSON.stringify(content)) differentWinner = true;
    }
    // Never return provisional content that lost the immutable insert race.
    // The next explicit request reads the durable winner; no hidden retry.
    if (differentWinner) throw new Error("Ringkasan publik tersimpan bersamaan. Muat ulang ringkasan.");
    return result;
  }
  return {
    publicSummary: () => read(scoped => createExamination(scoped, institution, preparation, packageId).publicSummary()),
    examination: () => runtime.registry
      ? read(scoped => createExamination(scoped, institution, preparation, packageId).export())
      : createExamination(runtime, institution, preparation, packageId).export(),
    publicationView: () => read(async scoped => {
      const publication = createRecording(scoped, scoped.registry!, institution, preparation, packageId, true);
      const [version, history] = await Promise.all([publication.version(), publication.history()]);
      return { version, history };
    }),
  };
}
