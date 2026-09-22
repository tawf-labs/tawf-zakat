import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";

const live = new Set<ReturnType<typeof Bun.spawn>>();
let handlersRegistered = false;

function registerTerminationHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  const killAll = () => {
    for (const node of live) {
      if (node.exitCode === null) node.kill();
    }
  };
  // afterAll cannot be relied on: a timeout, Ctrl-C, or a broken output pipe
  // (SIGPIPE from `bun test | head`) can end the process before it runs,
  // leaving Anvil holding the port for the next run.
  process.on("exit", killAll);
  process.on("SIGINT", () => { killAll(); process.exit(130); });
  process.on("SIGTERM", () => { killAll(); process.exit(143); });
}

export async function startAnvil(port: number) {
  registerTerminationHandlers();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const rpc = createPublicClient({ chain: foundry, pollingInterval: 25, transport: http(rpcUrl, { retryCount: 0, timeout: 500 }) });
  let occupied = false;
  try { await rpc.getChainId(); occupied = true; } catch { /* The isolated fixture must own this port. */ }
  if (occupied) throw new Error(`Port ${port} sudah digunakan; hentikan fixture Anvil lama sebelum menjalankan suite.`);
  const node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", String(port), "--silent"], { stdout: "ignore", stderr: "pipe" });
  live.add(node);
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { await rpc.getChainId(); ready = true; break; } catch { await Bun.sleep(100); }
  }
  if (!ready) throw new Error("Local Anvil did not start");
  return {
    node,
    async stop() {
      live.delete(node);
      if (node.exitCode === null) { node.kill(); await node.exited; }
    },
  };
}
