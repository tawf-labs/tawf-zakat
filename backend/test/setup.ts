// Runs before test imports, even when .env sets NODE_ENV=development.
if (!Bun.semver.satisfies(Bun.version, ">=1.4.2")) {
  throw new Error("Backend tests require Bun >=1.4.2 (older Playwright cleanup can invalidate SQL file descriptors). Run: mise exec -- bun test");
}
process.env.NODE_ENV = "test";
process.env.ENABLE_EMBEDDED_INDEXER = "false";
process.env.DEPLOYMENT_PENDING = "false";
process.env.INDEXER_START_BLOCK = "304590800";
for (const key of [
  "DATABASE_URL", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
  "MIDTRANS_SERVER_KEY", "PINATA_JWT", "PRIVATE_KEY", "RELAYER_PRIVATE_KEY",
]) {
  delete process.env[key];
}

// Override the legacy relayer key fallback and keep RPC reads on loopback.
process.env.RELAYER_PRIVATE_KEY = "test-signing-disabled";
process.env.SEPOLIA_RPC_URL = "http://127.0.0.1:1";
