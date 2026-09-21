/**
 * From backend/: bun src/scripts/pilot-deployment.ts [--input public-roles.json] [--preflight]
 * Default: offline plan only. RPC reads require --preflight and PILOT_RPC_URL.
 * No keys, environment configuration, database writes, funding or transactions are used.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, encodeFunctionData, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { buildPilotPlan, CONTRACTS, parsePilotInput, verifyArtifact, type PilotArtifacts } from "./pilot-deployment-plan";
import { preflightPilot } from "./pilot-deployment-preflight";

const root = resolve(import.meta.dir, "../../..");
export async function loadPilotArtifacts() {
  const artifacts = {} as PilotArtifacts;
  for (const spec of CONTRACTS) {
    const artifact = JSON.parse(await readFile(resolve(root, `sc/out/${spec.name}.sol/${spec.name}.json`), "utf8"));
    artifacts[spec.name] = await verifyArtifact(spec, artifact, path => readFile(resolve(root, "sc", path), "utf8"));
  }
  return artifacts;
}
export async function runPilotDeployment(args: string[]) {
  let inputPath: string | undefined;
  let preflight = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1] && !args[i + 1]!.startsWith("--") && !inputPath) inputPath = args[++i];
    else if (args[i] === "--preflight" && !preflight) preflight = true;
    else if (args[i] === "--help" && args.length === 1) return { usage: "bun src/scripts/pilot-deployment.ts --input public-roles.json [--preflight]", rpc: "PILOT_RPC_URL (used only with --preflight; never printed)", ...pendingInput() };
    else throw new Error("Unsupported arguments; use --help. Broadcast is not supported.");
  }
  if (!inputPath) {
    if (preflight) throw new Error("--preflight requires --input");
    return pendingInput();
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(inputPath, "utf8")); }
  catch { throw new Error("Cannot read public input JSON; details redacted"); }
  const plan = buildPilotPlan(parsePilotInput(value));
  const artifacts = await loadPilotArtifacts();
  // ABI-encode every planned grant now, rather than discovering stale interfaces later.
  for (const action of plan.actions) encodeFunctionData({ abi: artifacts[action.contract].abi, functionName: action.functionName, args: action.args });
  const artifactSummary = Object.fromEntries(CONTRACTS.map(s => [s.name, { source: artifacts[s.name].source, bytecodeHash: artifacts[s.name].bytecodeHash }]));
  if (!preflight) return { ...plan, artifacts: artifactSummary };
  const url = process.env.PILOT_RPC_URL;
  if (!url || !/^https?:\/\//.test(url)) throw new Error("Set PILOT_RPC_URL to an HTTP(S) endpoint for explicit read-only preflight");
  const rpc = createPublicClient({ chain: arbitrumSepolia, transport: http(url, { retryCount: 0, timeout: 15_000 }) });
  return { ...plan, artifacts: artifactSummary, preflight: await preflightPilot(plan, artifacts, rpc) };
}
function pendingInput() {
  return { mode: "plan-only", broadcastEnabled: false, status: "pending-public-input", chainId: 421614,
    requiredInput: { chainId: 421614, syntheticOnly: true, institutionId: "<synthetic institution ID>", budgetWei: "<aggregate positive wei cap, at most 5000000000000000>",
      allowHistoricalCompromisedWallet: "explicit boolean opt-in required if the historical compromised wallet is used",
      roles: Object.fromEntries(["deployer", "admission", "administrator", "relayer", "reportSignatory", "validator", "zkSigner", "custodian", "browserOfficer", "browserApprover"].map(role => [role, "<explicit public address>"])),
      auditor: "optional { address: public address, mandate: nonempty synthetic mandate }" },
    prerequisites: ["Build current contracts with: cd sc && forge build", "Report signatory must differ from validator; browser officer must differ from approver and report signatory.", "No private keys are accepted. Public roles do not establish key possession, personal identities or workspace membership."] };
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await runPilotDeployment(process.argv.slice(2)), null, 2)); }
  catch (error) {
    // Only our bounded validation diagnostics are printable. Filesystem/RPC/library exceptions
    // can contain URLs, secret values or request payloads; do not dump stacks or causes.
    const message = error instanceof Error ? error.message : "";
    const safe = /^(Invalid public pilot input:|Report signatory|Browser officer|Historical compromised|Unsupported arguments|--preflight requires|Cannot read public input|Set PILOT_RPC_URL|RPC chain mismatch|Deployer has code|(?:ReportEvidenceRegistry|Groth16Verifier|ContributionProofRegistry|DistributionCertificateNFT): (?:wrong compilation target|ABI missing|constructor mismatch|not the five-input contribution verifier|missing or unlinked creation bytecode|source metadata missing|unsafe source path|stale source hash))/.test(message);
    console.error(safe ? message : "Pilot preparation failed; check current build artifacts/public input/RPC. Underlying details redacted.");
    process.exitCode = 1;
  }
}
