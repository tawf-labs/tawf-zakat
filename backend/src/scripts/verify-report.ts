/** bun backend/src/scripts/verify-report.ts examination.json [--rpc URL --chain-id ID --registry ADDRESS] */
import { verifyExamination } from "../report-verifier";
try {
  const [path, ...args] = process.argv.slice(2);
  if (!path) throw new Error("Path examination.json diperlukan.");
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--rpc", "--chain-id", "--registry"].includes(args[i]!) || !args[i + 1]) throw new Error("Argumen verifier tidak sah.");
    options.set(args[i]!, args[i + 1]!);
  }
  let connection;
  if (options.size) {
    const rpcUrl = options.get("--rpc"), chainId = Number(options.get("--chain-id")), registry = options.get("--registry");
    if (!rpcUrl || !/^https?:\/\//.test(rpcUrl) || !Number.isSafeInteger(chainId) || chainId < 1 || !registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) throw new Error("RPC, chain-id, dan registry independen wajib lengkap.");
    connection = { rpcUrl, chainId, registry: registry as `0x${string}` };
  }
  const result = await verifyExamination(await Bun.file(path).json(), connection);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 2;
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Pemeriksaan gagal." }));
  process.exitCode = 1;
}
