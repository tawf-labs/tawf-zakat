"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { checkRuntimes, verifyArtifacts, verifyRelease, cleanEnv } = require("./release-lib.cjs");
function preflight(root, smoke = false) {
  const runtimes = checkRuntimes();
  verifyRelease(root);
  const verifierRuntimeSha256 = verifyArtifacts(root);
  const runner = path.join(root, "backend/dist/zk-prover-runner.cjs");
  const fromRunner = createRequire(runner);
  const resolved = fromRunner.resolve("snarkjs");
  const dependencyRoot = path.join(root, "backend/node_modules") + path.sep;
  if (!fs.realpathSync(resolved).startsWith(fs.realpathSync(dependencyRoot) + path.sep)) throw new Error("snarkjs must resolve inside this release's backend/node_modules, not an ancestor installation.");
  const snarkjs = fromRunner("snarkjs");
  if (typeof snarkjs.groth16?.fullProve !== "function") throw new Error("snarkjs fullProve unavailable from runner.");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "backend/package.json"), "utf8"));
  for (const dependency of Object.keys(manifest.dependencies)) fromRunner.resolve(dependency);
  const verifier = JSON.parse(fs.readFileSync(path.join(root, "sc/out/Groth16Verifier.sol/Groth16Verifier.json"), "utf8"));
  const metadata = typeof verifier.metadata === "string" ? JSON.parse(verifier.metadata) : verifier.metadata;
  const { keccak256 } = fromRunner("viem");
  const source = fs.readFileSync(path.join(root, "sc/src/Groth16Verifier.sol"));
  if (metadata?.sources?.["src/Groth16Verifier.sol"]?.keccak256 !== keccak256(source)) throw new Error("Verifier compiler metadata does not match the pinned Solidity source.");
  if (smoke) execFileSync("node", [path.join(root, "deploy/proof-smoke.cjs"), root], { cwd: root, env: cleanEnv(), stdio: "inherit", timeout: 180000 });
  console.log(JSON.stringify({ ok: true, runtimes, snarkjs: resolved, verifierRuntimeSha256, offlineProofSmoke: smoke ? "passed" : "not requested", chainDeployment: "NOT CHECKED", pm2Environment: "NOT CHECKED" }, null, 2));
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) console.log("Usage: node deploy/preflight-backend.cjs [--smoke]\nRun from any cwd after a TARGET-LOCAL dependency installation:\n  cd <release>/backend && bun --no-env-file install --frozen-lockfile --production --ignore-scripts\nSet TAWF_NODE_BIN_DIR to the absolute genuine Node wrapper directory when PATH contains a Bun node shim; it is prepended and propagated to child processes. Invoke this script with that genuine Node executable too.\nChecks real Node on PATH (rejects Bun shim), Bun >=1.4.2, all release checksums, all six circuit pins, verifier metadata, and runner dependency resolution.\n--smoke generates a synthetic proof through the shipped Node runner and verifies it locally; no RPC, transactions, DB or app startup.\nDoes NOT validate deployed chain addresses, target environment or PM2 activation. Preserve existing environment and obtain separate activation authorization.");
  else if (args.some(arg => arg !== "--smoke")) { console.error("Unknown arguments; use --help"); process.exitCode = 1; }
  else { try { preflight(path.resolve(__dirname, ".."), args.includes("--smoke")); } catch (error) { console.error(`Preflight failed: ${error.message}`); process.exitCode = 1; } }
}
module.exports = { preflight };
