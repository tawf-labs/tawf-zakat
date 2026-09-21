"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PAYLOAD, cleanEnv, regularFile, checkRuntimes, verifyArtifacts, inventory, digest } = require("./release-lib.cjs");

function stage(root) {
  const runtimes = checkRuntimes();
  verifyArtifacts(root);
  const base = path.join(root, ".scratch/demo-release");
  fs.mkdirSync(base, { recursive: true });
  if (fs.realpathSync(base) !== base) throw new Error("Staging directory must not contain symlinks.");
  const release = fs.mkdtempSync(path.join(base, "release-"));
  // Build directly into a fresh release, never reuse a stale dist or touch existing dist.
  // External packages are installed from bun.lock ON THE TARGET architecture. Shared
  // TypeScript modules are bundled; no shared source directory is needed at runtime.
  for (const entry of ["index", "indexer"]) {
    execFileSync("bun", ["--no-env-file", "build", `./src/${entry}.ts`, "--target=bun", "--packages=external", "--env=disable", `--outfile=${release}/backend/dist/${entry}.js`], {
      cwd: path.join(root, "backend"), env: cleanEnv(), stdio: "inherit", timeout: 120000,
    });
    const bundle = fs.readFileSync(path.join(release, `backend/dist/${entry}.js`), "utf8");
    if (bundle.includes(root) || /\bvar __dirname\s*=/.test(bundle)) {
      throw new Error(`Non-relocatable ${entry} bundle: build-machine path or baked __dirname found.`);
    }
  }
  for (const relative of PAYLOAD) {
    if (["backend/dist/index.js", "backend/dist/indexer.js"].includes(relative)) continue;
    const source = relative === "backend/dist/zk-prover-runner.cjs" ? "backend/src/zk-prover-runner.cjs" : relative;
    const target = path.join(release, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(regularFile(root, source), target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o644);
  }
  verifyArtifacts(release);
  const files = inventory(release);
  const manifest = JSON.stringify({ format: 1, runtimes, files }, null, 2) + "\n";
  fs.writeFileSync(path.join(release, "release-manifest.json"), manifest, { flag: "wx" });
  console.log(JSON.stringify({ release, files: files.length + 1, bytes: files.reduce((n, f) => n + f.bytes, Buffer.byteLength(manifest)), manifestSha256: digest(manifest), runtimes }, null, 2));
  console.log("Target preparation only (not executed): cd <release>/backend && bun --no-env-file install --frozen-lockfile --production --ignore-scripts");
  console.log("Then: cd <release> && node deploy/preflight-backend.cjs --smoke");
  return release;
}
if (require.main === module) {
  if (process.argv.includes("--help")) {
    console.log("Usage: node deploy/stage-backend.cjs\nOffline local build and exact allowlist staging into .scratch/demo-release/release-<unique>.\nRequires real Node, Bun >=1.4.2, already installed backend build dependencies, and all pinned artifacts.\nNo installation, network, DB, env-file loading, PM2 or server mutation. Failed staging remains incomplete (no release manifest).\nOnly the manifest-required public Solidity fixture is included; no witness, private test inputs, DB, env, node_modules or uploads.\nSame source/toolchain produces the same payload and checksums; directory names are intentionally unique.\nKeep the existing PM2 environment; do not activate this release until separately authorized.");
  } else if (process.argv.length !== 2) {
    console.error("Unknown arguments; use --help"); process.exitCode = 1;
  } else {
    try { stage(path.resolve(__dirname, "..")); } catch (error) { console.error(`Staging failed: ${error.message}`); process.exitCode = 1; }
  }
}
module.exports = { stage };
