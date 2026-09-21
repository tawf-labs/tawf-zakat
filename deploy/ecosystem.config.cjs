"use strict";
// Preparation template only: importing this file does not start/reload PM2.
// Activation must separately link backend/.env to /home/tawf-labs/shared/backend/.env.
// Never copy that file or its values into this template/release.
const path = require("node:path");
const root = process.env.TAWF_RELEASE_DIR || path.resolve(__dirname, "..");
const bun = process.env.TAWF_BUN_PATH || "/home/tawf-labs/.bun/bin/bun";
// Verified genuine Node wrapper; it supplies its own local libatomic library path.
// Do not substitute /usr/local/bin/node (the VPS Bun shim).
const nodeBinDir = process.env.TAWF_NODE_BIN_DIR || "/home/tawf-labs/shared/runtimes/node-check-8CwcWi/bin";
for (const [name, value] of [["TAWF_RELEASE_DIR", root], ["TAWF_BUN_PATH", bun], ["TAWF_NODE_BIN_DIR", nodeBinDir]]) {
  if (!path.isAbsolute(value) || value.includes(path.delimiter)) throw new Error(`${name} must be one absolute path`);
}
const common = {
  cwd: path.join(root, "backend"),
  script: bun,
  interpreter: "none",
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  restart_delay: 3000,
  min_uptime: "10s",
  max_restarts: 10,
  time: true,
  env: {
    NODE_ENV: "production",
    DEPLOYMENT_PENDING: "false",
    ENABLE_EMBEDDED_INDEXER: "false",
    EVIDENCE_FILE_DIR: "/home/tawf-labs/shared/backend/evidence-files",
    TAWF_NODE_BIN_DIR: nodeBinDir,
    PATH: [nodeBinDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  },
};
module.exports = {
  apps: [
    { ...common, name: "tawf-api", args: "run dist/index.js", max_memory_restart: "512M", env: { ...common.env, PORT: "3001" } },
    { ...common, name: "tawf-indexer", args: "run dist/indexer.js", max_memory_restart: "256M", env: { ...common.env } },
  ],
};
