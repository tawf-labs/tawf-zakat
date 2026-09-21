"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ARTIFACTS, PAYLOAD, assertNode, assertBun, cleanEnv, inventory, verifyRelease, regularFile, verifyArtifacts } = require("./release-lib.cjs");
const root = path.resolve(__dirname, "..");
const scratch = path.join(root, ".scratch/demo-release-tests");
fs.mkdirSync(scratch, { recursive: true });
function fixture() { return fs.mkdtempSync(path.join(scratch, "case-")); }
function put(dir, file, value) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), value); }

test("Node shim rejected; Bun minimum strictly enforced", () => {
  assert.throws(() => assertNode({ node: "24.0.0", bun: "1.4.0" }), /Real Node/);
  assert.throws(() => assertNode({}), /Real Node/);
  assert.doesNotThrow(() => assertNode({ node: "24.0.0" }));
  for (const version of ["1.4.0", "1.4.1", "1.3.99", "0.99.0", "1.4.2-canary", "garbage"]) assert.throws(() => assertBun(version));
  for (const version of ["1.4.2", "1.5.0", "2.0.0"]) assert.doesNotThrow(() => assertBun(version));
});
test("child environment excludes application secrets and preload hooks", () => {
  assert.deepEqual(Object.keys(cleanEnv()).sort(), ["LANG", "NODE_ENV", "PATH", ...(process.env.TAWF_NODE_BIN_DIR ? ["TAWF_NODE_BIN_DIR"] : []), "TZ"]);
  assert.equal(cleanEnv().NODE_ENV, "test");
});
test("explicit genuine Node directory survives clean child environment", () => {
  const script = `console.log(JSON.stringify(require(${JSON.stringify(path.join(__dirname, "release-lib.cjs"))}).cleanEnv()))`;
  const env = JSON.parse(execFileSync(process.execPath, ["-e", script], { env: { PATH: "/usr/local/bin:/usr/bin", TAWF_NODE_BIN_DIR: "/verified/node/bin", PRIVATE_KEY: "must-not-leak", NODE_OPTIONS: "" }, encoding: "utf8" }));
  assert.equal(env.PATH, "/verified/node/bin:/usr/local/bin:/usr/bin");
  assert.equal(env.TAWF_NODE_BIN_DIR, "/verified/node/bin");
  assert.equal(env.PRIVATE_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_ENV, "test");
});
test("PM2 preparation template preserves inspected processes, paths and Node precedence without activating", () => {
  const configPath = path.join(__dirname, "ecosystem.config.cjs");
  // Import under Node with no PM2 available or commands invoked; only JSON is printed.
  const load = overrides => JSON.parse(execFileSync(process.execPath, ["-e", `console.log(JSON.stringify(require(${JSON.stringify(configPath)})))`], { env: { PATH: "/usr/local/bin:/usr/bin", PRIVATE_KEY: "must-not-leak", DATABASE_URL: "must-not-leak", ...overrides }, encoding: "utf8" }));
  const config = load({});
  assert.equal(config.apps.length, 2);
  assert.deepEqual(config.apps.map(app => app.name), ["tawf-api", "tawf-indexer"]);
  assert.deepEqual(config.apps.map(app => app.args), ["run dist/index.js", "run dist/indexer.js"]);
  assert.deepEqual(config.apps.map(app => app.max_memory_restart), ["512M", "256M"]);
  assert.equal(config.apps[0].env.PORT, "3001");
  assert.equal(config.apps[1].env.PORT, undefined);
  for (const app of config.apps) {
    assert.equal(app.cwd, path.join(root, "backend"));
    assert.equal(app.script, "/home/tawf-labs/.bun/bin/bun");
    assert.equal(app.interpreter, "none");
    assert.equal(app.exec_mode, "fork");
    assert.equal(app.instances, 1);
    assert.equal(app.autorestart, true);
    assert.equal(app.restart_delay, 3000);
    assert.equal(app.min_uptime, "10s");
    assert.equal(app.max_restarts, 10);
    assert.equal(app.time, true);
    assert.equal(app.env.NODE_ENV, "production");
    assert.equal(app.env.DEPLOYMENT_PENDING, "false");
    assert.equal(app.env.ENABLE_EMBEDDED_INDEXER, "false");
    assert.equal(app.env.EVIDENCE_FILE_DIR, "/home/tawf-labs/shared/backend/evidence-files");
    assert.equal(app.env.TAWF_NODE_BIN_DIR, "/home/tawf-labs/shared/runtimes/node-check-8CwcWi/bin");
    assert.equal(app.env.PATH, app.env.TAWF_NODE_BIN_DIR + ":/usr/local/bin:/usr/bin");
    assert.equal(app.env.PRIVATE_KEY, undefined);
    assert.equal(app.env.DATABASE_URL, undefined);
  }
  assert(!JSON.stringify(config).includes("must-not-leak"));
  const overridden = load({ TAWF_RELEASE_DIR: "/release/candidate", TAWF_BUN_PATH: "/runtime/bun", TAWF_NODE_BIN_DIR: "/runtime/node/bin" });
  for (const app of overridden.apps) {
    assert.equal(app.cwd, "/release/candidate/backend");
    assert.equal(app.script, "/runtime/bun");
    assert.equal(app.env.PATH, "/runtime/node/bin:/usr/local/bin:/usr/bin");
  }
});
test("allowlist carries exactly six public manifest artifacts and no private runtime data", () => {
  assert.equal(Object.keys(ARTIFACTS).length, 6);
  assert.equal(new Set(PAYLOAD).size, PAYLOAD.length);
  assert(PAYLOAD.includes("sc/test/ContributionProofFixture.sol"));
  assert(PAYLOAD.includes("backend/bun.lock"));
  assert(PAYLOAD.includes("deploy/ecosystem.config.cjs"));
  assert(PAYLOAD.includes("sc/out/Groth16Verifier.sol/Groth16Verifier.json"));
  for (const file of PAYLOAD) assert(!/(?:node_modules|\.env|\.db|witness|sample_test_proof|input\.json)/i.test(file), file);
});
test("inventory is deterministic, ignores unrelated data, and rejects corruption/missing files", () => {
  const dir = fixture();
  for (const file of PAYLOAD) put(dir, file, `fixture:${file}`);
  put(dir, ".env", "SECRET=not-in-inventory");
  put(dir, "uploads/private.txt", "not-in-inventory");
  const files = inventory(dir);
  assert.deepEqual(inventory(dir), files);
  put(dir, "release-manifest.json", JSON.stringify({ format: 1, files }));
  assert.equal(verifyRelease(dir).format, 1);
  put(dir, PAYLOAD[0], "corrupt");
  assert.throws(() => verifyRelease(dir), /checksum mismatch/);
  fs.renameSync(path.join(dir, PAYLOAD[0]), path.join(dir, "removed"));
  assert.throws(() => verifyRelease(dir), /ENOENT/);
});
test("path traversal, file symlinks and ancestor symlinks fail closed", () => {
  const dir = fixture();
  put(dir, "real/file", "ok");
  fs.symlinkSync(path.join(dir, "real/file"), path.join(dir, "link"));
  fs.symlinkSync(path.join(dir, "real"), path.join(dir, "linked-dir"));
  assert.throws(() => regularFile(dir, "../outside"), /escapes/);
  assert.throws(() => regularFile(dir, "link"), /Symlink/);
  assert.throws(() => regularFile(dir, "linked-dir/file"), /Symlink/);
});
test("manifest cannot smuggle extra paths or replace pinned checksums", () => {
  const dir = fixture();
  put(dir, "sc/circuits/artifacts.sha256", Object.entries(ARTIFACTS).map(([p, h]) => `${h}  ${p}`).join("\n") + "\n" + "0".repeat(64) + "  ../../.env\n");
  assert.throws(() => verifyArtifacts(dir), /six pinned/);
});
test("optional staged release offline installation and real runner smoke", { skip: !process.env.RELEASE_SMOKE_ROOT, timeout: 240000 }, () => {
  const staged = path.resolve(process.env.RELEASE_SMOKE_ROOT);
  verifyRelease(staged);
  const dir = fixture();
  for (const file of [...PAYLOAD, "release-manifest.json"]) {
    const destination = path.join(dir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(regularFile(staged, file), destination);
  }
  // Only this test clone receives local dependencies, never the deliverable.
  if (process.env.RELEASE_USE_WORKSPACE_DEPS === "1") {
    console.log("SMOKE ONLY: using existing workspace dependencies; target lockfile installation is NOT validated.");
    fs.symlinkSync(path.join(root, "backend/node_modules"), path.join(dir, "backend/node_modules"));
  } else {
    execFileSync("bun", ["--no-env-file", "install", "--offline", "--frozen-lockfile", "--production", "--ignore-scripts"], { cwd: path.join(dir, "backend"), env: cleanEnv(), stdio: "inherit", timeout: 60000 });
  }
  execFileSync("node", [path.join(dir, "deploy/preflight-backend.cjs"), "--smoke"], { cwd: dir, env: cleanEnv(), stdio: "inherit", timeout: 180000 });
  execFileSync("node", [path.join(__dirname, "relocation-check.cjs"), dir, root], { cwd: dir, env: cleanEnv(), stdio: "inherit", timeout: 180000 });
});

test("staging/preflight help is side-effect free", () => {
  for (const script of ["stage-backend.cjs", "preflight-backend.cjs"]) {
    assert.match(execFileSync(process.execPath, [path.join(__dirname, script), "--help"], { env: cleanEnv(), encoding: "utf8" }), /Usage:/);
  }
});
