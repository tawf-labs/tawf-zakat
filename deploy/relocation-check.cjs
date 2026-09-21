"use strict";
// Test-only instrumentation of a disposable COPY of the actual API bundle.
// No source module rebuilds or imports: only add exports to reach its private functions.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { cleanEnv } = require("./release-lib.cjs");
async function check(root, sourceRoot) {
  const fromRunner = createRequire(path.join(root, "backend/dist/zk-prover-runner.cjs"));
  const bundle = fs.readFileSync(path.join(root, "backend/dist/index.js"), "utf8");
  if (bundle.includes(sourceRoot) || /\bvar __dirname\s*=/.test(bundle)) throw new Error("API bundle contains build-machine paths");
  const instrumented = path.join(root, "backend/dist/relocation-api.js");
  fs.writeFileSync(instrumented, bundle + "\nexport { createZkProofService as relocationProver, publicationArtifactId as relocationPublication };\n", { flag: "wx" });
  const poseidon = await fromRunner("circomlibjs").buildPoseidon();
  const hash = values => poseidon.F.toString(poseidon(values.map(BigInt)));
  const input = { institutionKey: "44", contributionIdHash: "11", fundType: 1, amount: "100", salt: "22", purposeHash: "33", pathElements: ["0", "0", "0", "0"], pathIndices: [0, 0, 0, 0] };
  const leaf = hash([input.contributionIdHash, input.amount, input.salt, input.fundType, input.purposeHash]);
  input.receiptCommitment = hash([input.institutionKey, input.contributionIdHash, leaf]);
  input.batchRoot = input.pathElements.reduce((current, sibling) => hash([current, sibling]), leaf);
  fs.mkdirSync(path.join(root, ".scratch"), { recursive: true });
  const probe = path.join(root, "backend/dist/relocation-probe.mjs");
  fs.writeFileSync(probe, `
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { relocationProver, relocationPublication } from "./relocation-api.js";
const root = ${JSON.stringify(root)};
const input = ${JSON.stringify(input)};
const prover = relocationProver(); // NO path overrides: the shipped app's defaults.
prover.assertArtifacts();
const manifest = root + "/sc/circuits/artifacts.sha256";
assert.equal(relocationPublication(), createHash("sha256").update(readFileSync(manifest)).digest("hex"));
const original = readFileSync(manifest);
try {
  writeFileSync(manifest, "relocation-negative-control");
  assert.equal(relocationPublication(), createHash("sha256").update("relocation-negative-control").digest("hex"));
  assert.throws(() => prover.assertArtifacts());
} finally { writeFileSync(manifest, original); }
const artifact = root + "/sc/out/Groth16Verifier.sol/Groth16Verifier.json";
const bytecode = JSON.parse(readFileSync(artifact, "utf8")).deployedBytecode.object;
const client = { readContract: async () => "0x0000000000000000000000000000000000000001", getBytecode: async () => bytecode };
await prover.assertDeployment(client, "0x0000000000000000000000000000000000000002");
renameSync(artifact, artifact + ".hidden");
try { await assert.rejects(() => prover.assertDeployment(client, "0x0000000000000000000000000000000000000002")); }
finally { renameSync(artifact + ".hidden", artifact); }
for (const relative of ["sc/circuits/build/circuit_final.zkey", "sc/circuits/build/contribution_membership_js/contribution_membership.wasm", "backend/dist/zk-prover-runner.cjs"]) {
  const file = root + "/" + relative;
  renameSync(file, file + ".hidden");
  try { await assert.rejects(() => prover.generateProof(input)); }
  finally { renameSync(file + ".hidden", file); }
}
const result = await prover.generateProof(input);
writeFileSync(root + "/.scratch/relocation-proof.json", JSON.stringify(result));
process.exit(0);
`, { flag: "wx" });
  execFileSync("bun", ["--no-env-file", probe], { cwd: root, env: { ...cleanEnv(), TMPDIR: path.join(root, ".scratch") }, stdio: "inherit", timeout: 180000 });
  const result = JSON.parse(fs.readFileSync(path.join(root, ".scratch/relocation-proof.json"), "utf8"));
  const expected = [input.batchRoot, input.receiptCommitment, input.institutionKey, input.contributionIdHash, String(input.fundType)];
  require("node:assert/strict").deepEqual(result.publicSignals, expected);
  const vk = JSON.parse(fs.readFileSync(path.join(root, "sc/circuits/build/verification_key.json"), "utf8"));
  if (!await fromRunner("snarkjs").groth16.verify(vk, result.publicSignals, result.proof)) throw new Error("Relocated app proof invalid");
  fs.unlinkSync(path.join(root, ".scratch/relocation-proof.json"));
  console.log("Relocated ACTUAL API bundle: default prover paths, publication manifest, verifier JSON, negative fallback controls and real proof verification PASS.");
}
if (require.main === module) check(path.resolve(process.argv[2]), path.resolve(process.argv[3])).then(() => process.exit(0), error => { console.error(error); process.exit(1); });
