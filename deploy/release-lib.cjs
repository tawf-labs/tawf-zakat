"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

// Exact pilot pins, not arbitrary paths supplied by a mutable manifest.
const ARTIFACTS = {
  "contribution_membership.circom": "b0529f14751ce34f8fd0b40b6c2021c28b635327dfd05fede848dd48326fec98",
  "build/contribution_membership_js/contribution_membership.wasm": "776ce11619f2d711e9ef12bc4a3bd014e990b503fb81c0b47aa456100689805d",
  "build/circuit_final.zkey": "5b7f950a1a6e831c09d9ff95591a0be48b7d3638192229a2015377917a6ae28a",
  "build/verification_key.json": "288818db2747fc81cd7b7dbb67acc6ac700b3acddb3e9096d9416bb1d78db95c",
  "../src/Groth16Verifier.sol": "9e4667b29f0860532e5922136ad602c3724561e7beacfde4f57f824c02959328",
  "../test/ContributionProofFixture.sol": "48164994a2cdff26ef8833174e4e4b6bafd397fd5122e59815ffae8bbc66d305",
};
const PAYLOAD = [
  "backend/dist/index.js", "backend/dist/indexer.js", "backend/dist/zk-prover-runner.cjs",
  "backend/package.json", "backend/bun.lock", "sc/circuits/artifacts.sha256",
  ...Object.keys(ARTIFACTS).map(p => path.posix.normalize(`sc/circuits/${p}`)),
  "sc/out/Groth16Verifier.sol/Groth16Verifier.json",
  "deploy/release-lib.cjs", "deploy/preflight-backend.cjs", "deploy/proof-smoke.cjs", "deploy/ecosystem.config.cjs",
].sort();
function cleanEnv() {
  const env = { PATH: process.env.PATH, NODE_ENV: "test", TZ: "UTC", LANG: "C" };
  const nodeBinDir = process.env.TAWF_NODE_BIN_DIR;
  if (nodeBinDir) {
    if (!path.isAbsolute(nodeBinDir) || nodeBinDir.includes(path.delimiter)) throw new Error("TAWF_NODE_BIN_DIR must be one absolute path");
    env.TAWF_NODE_BIN_DIR = nodeBinDir;
    env.PATH = [nodeBinDir, env.PATH].filter(Boolean).join(path.delimiter);
  }
  return env;
}
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function regularFile(root, relative) {
  const full = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Path escapes root: ${relative}`);
  // Reject symlinked ancestors too; never copy an outside file through a directory link.
  let cursor = path.resolve(root);
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink forbidden: ${relative}`);
  }
  if (!fs.statSync(full).isFile()) throw new Error(`Not a regular file: ${relative}`);
  return full;
}
function assertNode(versions = process.versions) {
  if (!versions.node || versions.bun) throw new Error("Real Node.js required; Bun's node shim is not supported.");
}
function assertBun(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && (Number(match[2]) < 4 || (Number(match[2]) === 4 && Number(match[3]) < 2)))) {
    throw new Error(`Bun >=1.4.2 (stable) required; found ${version.trim()}`);
  }
}
function checkRuntimes() {
  assertNode();
  // Production invokes literal "node", so checking only this script's interpreter is insufficient.
  const node = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(process.versions)"], { env: cleanEnv(), encoding: "utf8", timeout: 10000 }));
  assertNode(node);
  const bun = execFileSync("bun", ["--version"], { env: cleanEnv(), encoding: "utf8", timeout: 10000 }).trim();
  assertBun(bun);
  return { node: node.node, bun };
}
function verifyArtifacts(root) {
  const expected = Object.entries(ARTIFACTS).map(([p, hash]) => `${hash}  ${p}`).sort();
  const manifest = fs.readFileSync(regularFile(root, "sc/circuits/artifacts.sha256"), "utf8").trim().split(/\r?\n/).sort();
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error("Artifact manifest differs from the six pinned pilot entries.");
  for (const [p, hash] of Object.entries(ARTIFACTS)) {
    const relative = path.posix.normalize(`sc/circuits/${p}`);
    if (digest(fs.readFileSync(regularFile(root, relative))) !== hash) throw new Error(`Artifact checksum mismatch: ${relative}`);
  }
  const verifier = JSON.parse(fs.readFileSync(regularFile(root, "sc/out/Groth16Verifier.sol/Groth16Verifier.json"), "utf8"));
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(verifier.deployedBytecode?.object)) throw new Error("Missing verifier runtime bytecode.");
  // Bind the compiler output to the pinned Solidity source, not just its filename.
  const metadata = typeof verifier.metadata === "string" ? JSON.parse(verifier.metadata) : verifier.metadata;
  const source = fs.readFileSync(regularFile(root, "sc/src/Groth16Verifier.sol"), "utf8");
  const recorded = metadata?.sources?.["src/Groth16Verifier.sol"]?.content;
  if (recorded !== undefined && recorded !== source) throw new Error("Verifier compiler source mismatch.");
  return digest(Buffer.from(verifier.deployedBytecode.object.slice(2), "hex"));
}
function inventory(root) {
  return PAYLOAD.map(p => {
    const bytes = fs.readFileSync(regularFile(root, p));
    return { path: p, bytes: bytes.length, sha256: digest(bytes) };
  });
}
function verifyRelease(root) {
  const recorded = JSON.parse(fs.readFileSync(regularFile(root, "release-manifest.json"), "utf8"));
  if (recorded.format !== 1 || JSON.stringify(recorded.files) !== JSON.stringify(inventory(root))) throw new Error("Release inventory/checksum mismatch.");
  return recorded;
}
module.exports = { ARTIFACTS, PAYLOAD, cleanEnv, digest, regularFile, assertNode, assertBun, checkRuntimes, verifyArtifacts, inventory, verifyRelease };
