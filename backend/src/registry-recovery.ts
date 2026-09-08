/** A polling pass never changes signed bytes. Every pass rechecks even previously confirmed attempts. */
import type { RegistryRuntime } from "./registry-recording";
import type { RecoveredIntent } from "./registry-recovery-store";
import { subjectOf } from "./registry-store";

export async function recoverRegistry(registry: RegistryRuntime, institution: string) {
  const { store, chain } = registry;
  const deployment = chain.recoveryDeployment;
  const previous = await store.recovery.read(deployment, institution);
  const head = await chain.recoveryHead();
  const replay = !!previous.checkpoint && await chain.canonicalBlock(previous.checkpoint.blockNumber) !== previous.checkpoint.blockHash;
  // Pilot deliberately replays the complete event range in bounded RPC batches. Late logs
  // are recovered too, without assuming an index provider never omits a historical log.
  const events = await chain.recoveryEvents(institution, 0n, BigInt(head.blockNumber));
  const observations: RecoveredIntent[] = [];
  for (const intent of await store.recovery.intents(institution)) {
    if (intent.domain.chainId !== chain.domain.chainId || intent.domain.verifyingContract.toLowerCase() !== chain.domain.verifyingContract.toLowerCase()) continue;
    const attempt = await store.attempt(subjectOf(intent).institutionId, intent.id);
    if (attempt) observations.push({ intent, hash: attempt.hash, observation: await chain.observe(intent, attempt.hash, BigInt(head.blockNumber)) });
  }
  for (const item of observations) {
    const observed = item.observation;
    if (["CONFIRMED", "INCLUDED"].includes(observed.state) && !events.some(event => event.transactionHash === item.hash
      && event.logIndex === observed.logIndex && event.blockHash === observed.blockHash)) {
      throw new Error("Event receipt belum tersedia pada pembacaan log; checkpoint ditahan.");
    }
  }
  // Descendants may be produced during a pass. Only replacement of the captured
  // block invalidates the view; all confirmation depths above are pinned to it.
  if (await chain.canonicalBlock(head.blockNumber) !== head.blockHash) throw new Error("Blok acuan berubah; ulangi.");
  await store.recovery.commit(deployment, institution, previous.checkpoint,
    { ...head, policy: chain.confirmationPolicy, checkedAt: Date.now() }, events, observations, replay);
  return recoveryStatus(registry, institution);
}

export async function recoveryStatus({ store, chain }: RegistryRuntime, institution: string) {
  const saved = await store.recovery.read(chain.recoveryDeployment, institution);
  let state: "CURRENT" | "CATCHING_UP" | "RECHECK_REQUIRED" = "RECHECK_REQUIRED";
  try {
    const head = await chain.recoveryHead();
    if (saved.checkpoint && saved.checkpoint.policy === chain.confirmationPolicy && Date.now() - saved.checkpoint.checkedAt < 30000
      && await chain.canonicalBlock(saved.checkpoint.blockNumber) === saved.checkpoint.blockHash) {
      state = saved.checkpoint.blockHash === head.blockHash ? "CURRENT" : "CATCHING_UP";
    }
  } catch { /* Last durable checkpoint is history, never proof of current availability. */ }
  return { ...saved, state, deployment: chain.recoveryDeployment, confirmationPolicy: chain.confirmationPolicy,
    requiredConfirmations: chain.requiredConfirmations, settlement: "BLOCK_DEPTH_ONLY_NOT_L1_FINALITY" };
}

/** Serialized cycles, including after a failure. A crashed process resumes from durable state. */
export function startRegistryRecovery(registry: RegistryRuntime, intervalMs = 5000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      for (const institution of await registry.store.recovery.institutions()) {
        try { await recoverRegistry(registry, institution); }
        catch { console.warn("Registry recovery requires another canonical check."); }
      }
    } catch { console.warn("Registry recovery storage unavailable."); }
    finally { if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref(); } }
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
