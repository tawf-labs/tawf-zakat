import { crowdfundingStoreFromEnv } from "./crowdfunding-store";
import { campaignDocumentKeyFromEnv, campaignFileStoreFromEnv } from "./crowdfunding-documents";
import { crowdfundingGatewayFromEnv } from "./crowdfunding-midtrans";
import { drainCampaignOutbox, type CampaignRuntime } from "./crowdfunding";

let installedRuntime: CampaignRuntime | null = null;
export const crowdfundingRuntime = () => installedRuntime;
export async function installCrowdfundingRuntime() { installedRuntime = await createCrowdfundingRuntime(); }
export function configureCrowdfundingForTests(runtime: CampaignRuntime | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("Test runtime injection is disabled");
  installedRuntime = runtime;
}

export async function createCrowdfundingRuntime(): Promise<CampaignRuntime | null> {
  const store = crowdfundingStoreFromEnv();
  if (!store) return null;
  const runtime: CampaignRuntime = { store, gateway: crowdfundingGatewayFromEnv(), chain: null, documentKey: campaignDocumentKeyFromEnv(), files: campaignFileStoreFromEnv() };
  // Dynamic loading avoids RPC/signing initialization in unconfigured or test runtimes.
  try {
    const { createCampaignChainRecorderFromEnv } = await import("./campaign-chain");
    runtime.chain = createCampaignChainRecorderFromEnv();
  } catch {
    console.error("[crowdfunding] chain unavailable; check adapter configuration");
  }
  if (runtime.chain && process.env.NODE_ENV !== "test" && process.env.DEPLOYMENT_PENDING !== "true") {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await drainCampaignOutbox(runtime); } catch { console.error("[crowdfunding] outbox unavailable; will retry"); } finally { running = false; }
    };
    setInterval(tick, 30000).unref();
    void tick();
  }
  return runtime;
}
