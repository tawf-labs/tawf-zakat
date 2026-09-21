/** Public-address-only, deterministic synthetic Arbitrum Sepolia preparation. No signing. */
import { z } from "zod";
import { keccak256, toHex, type Abi, type Address, type Hex } from "viem";

export const HISTORICAL_COMPROMISED_ADDRESS = "0x5e9b652c4e8a013f6fab69f0b55377c408b59968";
export const CONTRACTS = [
  { name: "ReportEvidenceRegistry", source: "src/ReportEvidenceRegistry.sol", constructorTypes: ["address"] },
  { name: "Groth16Verifier", source: "src/Groth16Verifier.sol", constructorTypes: [] },
  { name: "ContributionProofRegistry", source: "src/ContributionProofRegistry.sol", constructorTypes: ["address", "address"] },
  { name: "DistributionCertificateNFT", source: "src/DistributionCertificateNFT.sol", constructorTypes: ["address"] },
] as const;
export type ContractName = typeof CONTRACTS[number]["name"];
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(v => !/^0x0{40}$/i.test(v), "Zero address is forbidden").transform(v => v.toLowerCase() as Address);
const schema = z.object({
  chainId: z.literal(421614), syntheticOnly: z.literal(true),
  institutionId: z.string().trim().min(1).max(120),
  budgetWei: z.string().regex(/^[1-9][0-9]*$/).refine(v => /^[1-9][0-9]*$/.test(v) && BigInt(v) <= 5_000_000_000_000_000n, "Synthetic aggregate cap is 0.005 ETH"),
  allowHistoricalCompromisedWallet: z.boolean().default(false),
  roles: z.object({ deployer: address, admission: address, administrator: address, relayer: address, reportSignatory: address,
    validator: address, zkSigner: address, custodian: address, browserOfficer: address, browserApprover: address }).strict(),
  auditor: z.object({ address, mandate: z.string().trim().min(1).max(240) }).strict().optional(),
}).strict();
export type PilotInput = z.infer<typeof schema>;
export function parsePilotInput(value: unknown): PilotInput {
  const parsed = schema.safeParse(value);
  // Never echo invalid values (a mistakenly supplied secret must not reach logs).
  if (!parsed.success) throw new Error("Invalid public pilot input: " + parsed.error.issues.map(i => i.path.join(".") || "input").join(", "));
  const c = parsed.data;
  if (c.roles.reportSignatory === c.roles.validator) throw new Error("Report signatory and validator must be separate");
  if (c.roles.browserOfficer === c.roles.browserApprover || c.roles.browserOfficer === c.roles.reportSignatory) {
    throw new Error("Browser officer must be separate from approver and institutional report signatory");
  }
  if ([...Object.values(c.roles), c.auditor?.address].includes(HISTORICAL_COMPROMISED_ADDRESS as Address) && !c.allowHistoricalCompromisedWallet) {
    throw new Error("Historical compromised wallet requires allowHistoricalCompromisedWallet=true for synthetic testnet only");
  }
  return c;
}
type Argument = string | boolean | { contract: ContractName };
export type Deployment = { contract: ContractName; source: string; sender: Address; args: Argument[]; dependsOn: ContractName[] };
export type AuthorityAction = { contract: ContractName; functionName: string; sender: Address; args: Argument[] };
export function buildPilotPlan(input: PilotInput) {
  const c = parsePilotInput(input);
  const r = c.roles;
  const deployments: Deployment[] = CONTRACTS.map(spec => ({ contract: spec.name, source: spec.source, sender: r.deployer,
    args: spec.name === "ReportEvidenceRegistry" ? [r.admission] : spec.name === "ContributionProofRegistry" ? [{ contract: "Groth16Verifier" }, r.admission] : spec.name === "DistributionCertificateNFT" ? [{ contract: "ReportEvidenceRegistry" }] : [],
    dependsOn: spec.name === "ContributionProofRegistry" ? ["Groth16Verifier"] : spec.name === "DistributionCertificateNFT" ? ["ReportEvidenceRegistry"] : [],
  }));
  const actions: AuthorityAction[] = [
    { contract: "ReportEvidenceRegistry", functionName: "enrollInstitution", sender: r.admission, args: [c.institutionId, r.administrator] },
    { contract: "ReportEvidenceRegistry", functionName: "setSignatory", sender: r.administrator, args: [c.institutionId, r.reportSignatory, true] },
    { contract: "ReportEvidenceRegistry", functionName: "setValidator", sender: r.admission, args: [r.validator, true] },
    { contract: "ContributionProofRegistry", functionName: "enrollInstitution", sender: r.admission, args: [c.institutionId, r.administrator] },
    { contract: "ContributionProofRegistry", functionName: "setSigner", sender: r.administrator, args: [c.institutionId, r.zkSigner, true] },
  ];
  // Enrollment auto-authorizes the admin. Remove that implicit signer unless explicitly chosen.
  if (r.administrator !== r.zkSigner) actions.push({ contract: "ContributionProofRegistry", functionName: "setSigner", sender: r.administrator, args: [c.institutionId, r.administrator, false] });
  actions.push({ contract: "DistributionCertificateNFT", functionName: "setCustodian", sender: r.administrator, args: [c.institutionId, r.custodian] });
  if (c.auditor) actions.push({ contract: "ReportEvidenceRegistry", functionName: "setAuditor", sender: r.administrator, args: [c.institutionId, c.auditor.address, true, c.auditor.mandate] });
  const warnings = [
    "Synthetic testnet only; no production assets or real personal data.",
    "Admission remains the initial report validator operator and retains contribution-root authority even after admin signer revocation.",
    "Actions run in listed order only after all deployment receipts succeed; this plan neither sends transactions nor grants offchain workspace membership.",
    "Browser officer/approver addresses are explicit offchain onboarding inputs, not automatic contract mandates. They need distinct personal officer IDs and valid scoped operational mandates; a second address for the same officer cannot bypass self-approval rules. Budget ownership and ongoing relay/prover limits need operator approval.",
  ];
  if ([...Object.values(r), c.auditor?.address].includes(HISTORICAL_COMPROMISED_ADDRESS as Address)) warnings.push("WARNING: explicitly opted-in historical compromised wallet; anyone with the exposed key controls its roles. Testnet-only funds may be stolen; never use real assets.");
  return { version: 1, mode: "plan-only", broadcastEnabled: false as const, chainId: c.chainId, syntheticOnly: true,
    legacyProtocol: "0x0d6cec28a574aca41b879767b081f6f2b4e9a849", legacyProtocolAction: "preserve-unchanged",
    institutionId: c.institutionId, budgetWei: c.budgetWei, budgetScope: "aggregate deployment + authority + account funding + demo transactions; not broadcast authorization", roles: r, deployments, actions, warnings };
}
export type PilotPlan = ReturnType<typeof buildPilotPlan>;
export type VerifiedArtifact = { abi: Abi; bytecode: Hex; bytecodeHash: Hex; source: string };
export type PilotArtifacts = Record<ContractName, VerifiedArtifact>;

/** Verify the Foundry compilation target, constructor, linked bytecode and every recorded source hash.
 * This detects stale outputs and the identically named DAO verifier; it is not a compiler audit.
 */
export async function verifyArtifact(spec: typeof CONTRACTS[number], value: unknown, readSource: (path: string) => Promise<string>): Promise<VerifiedArtifact> {
  const a = value as { abi?: Abi; bytecode?: { object?: string }; metadata?: any; rawMetadata?: string };
  const fail = (reason: string): never => { throw new Error(`${spec.name}: ${reason}`); };
  const metadata = typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata ?? (a.rawMetadata ? JSON.parse(a.rawMetadata) : undefined);
  const targets = metadata?.settings?.compilationTarget;
  if (!targets || Object.keys(targets).length !== 1 || targets[spec.source] !== spec.name) fail("wrong compilation target");
  if (!Array.isArray(a.abi)) fail("ABI missing");
  const abi = a.abi!;
  const constructor = abi.find(item => item.type === "constructor");
  const types = constructor?.type === "constructor" ? constructor.inputs.map(i => i.type) : [];
  if (JSON.stringify(types) !== JSON.stringify(spec.constructorTypes)) fail("constructor mismatch");
  if (spec.name === "Groth16Verifier") {
    const verify = abi.find(item => item.type === "function" && item.name === "verifyProof");
    if (verify?.type !== "function" || verify.inputs.map(i => i.type).join(",") !== "uint256[2],uint256[2][2],uint256[2],uint256[5]" || verify.outputs.map(i => i.type).join() !== "bool") fail("not the five-input contribution verifier");
  }
  const bytecode = a.bytecode?.object;
  if (!bytecode || !/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) fail("missing or unlinked creation bytecode");
  if (!metadata?.sources?.[spec.source]) fail("source metadata missing");
  for (const [path, entry] of Object.entries(metadata.sources) as [string, { keccak256?: string }][]) {
    if (!/^(src|lib)\//.test(path) || path.split("/").includes("..") || path.includes("\\")) fail("unsafe source path");
    if (keccak256(toHex(await readSource(path))) !== entry.keccak256) fail("stale source hash; rebuild with forge build");
  }
  return { abi, bytecode: bytecode as Hex, bytecodeHash: keccak256(bytecode as Hex), source: spec.source };
}
