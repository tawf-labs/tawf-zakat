To install dependencies:
```sh
bun install
```

To run:
```sh
bun run dev
```

The API listens on `http://localhost:3001` by default (`PORT` overrides it).

## DeepSeek Report Drafting

Add the settings from `.env.example` to the existing `backend/.env`, preserving
the database, payment, relayer and other settings already present:

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

Set `DEEPSEEK_API_KEY` to a DeepSeek platform API key locally or in the backend
host's secret environment, then restart the backend. Keep it out of Git, browser
code, and all `VITE_` variables. The base URL and model above are the defaults;
only the key is required. Legacy `ANTHROPIC_*` settings are ignored and can be
removed from this app's server environment.

`POST /api/period-report/draft` uses non-thinking mode, JSON output, a 4,096-token
output cap, and one request with a 30-second timeout (including response reading).
There are no automatic retries or fallback providers. Only aggregated period
figures and report notes are sent, not donor or beneficiary identities. Zod
validates the response shape before the deterministic validator checks claims.
Missing credentials, insufficient balance, rate limits, timeouts, malformed JSON
and incomplete completions leave the figures available with `draftUnavailable`.

Run the focused tests without live credentials or a database:

```sh
env DATABASE_URL= DEEPSEEK_API_KEY= ENABLE_EMBEDDED_INDEXER=false NODE_ENV=test \
  bun --no-env-file test test/report_drafter.test.ts test/report_validator.test.ts \
  test/period_report.test.ts test/period_report_api.test.ts test/period_report_draft_api.test.ts
```

The HTTP boundary is stubbed in tests; no paid model call is made. A live demo
rehearsal is still needed to assess narrative quality and latency.

## Ruang Kerja Lembaga (Spec #68, ticket #69)

`/api/workspace` is the institutional workspace door. Access starts with a
server-minted challenge — `POST /challenge` — that the account signs under this
application's own EIP-712 domain (`Tawf Workspace Access`, no verifying
contract, so a sign-in can never be replayed as a vault governance action).
`POST /session` verifies the signature, spends the nonce and returns a bearer
token **once**; only its SHA-256 hash is stored. `GET /` reads the workspace,
`DELETE /session` revokes it, and `POST /members` is gated on the administrator
capability.

The institution a caller acts for comes from their membership. An
`institutionId` in a payload or query string may only agree with it;
disagreement is a 403, never a silent correction.

Workspace membership governs the workspace only. Recording evidence and
publishing a report are authorized by the registry onchain (ADR-0022), and no
row here is consulted as a fallback for a role the chain refuses.

### Local configuration and the dev migration

The workspace needs `DATABASE_URL`. Without it — and under `NODE_ENV=test`, or
while `DEPLOYMENT_PENDING=true` — the routes answer `503` and nothing falls back
to memory: a workspace whose memberships evaporate on restart is worse than one
that is plainly closed.

On startup with a database configured, `installWorkspaceRuntime()` runs
`WORKSPACE_SCHEMA_STATEMENTS` (see `src/tenancy-store.ts`). Every statement is
`IF NOT EXISTS`, so it is idempotent and **additive**: it creates
`institutions`, `institution_memberships`, `workspace_challenges` and
`workspace_sessions`, and alters no table that already exists. Nothing is
backfilled — rows recorded before institutions existed belong to no institution.

Onboarding is a separate, deliberate step — installing institutions is exactly
the thing that must not happen as a side effect of starting a server:

```
bun run seed:workspace
```

It records the two synthetic institutions in `src/fixtures/institutions.ts`
together with their accounts (an initial administrator, an Amil operasional, and
for one of them an authorised reader), and is idempotent. Until it is run the
`institutions` table is empty and `POST /api/workspace/challenge` correctly
answers 404 for every id.

The script refuses a non-local `DATABASE_URL` unless `--force` is passed. The
fixture accounts come from published Ethereum test keys and are worthless as
credentials, which is what a fixture account should be — and precisely why they
must never be given authority on a deployment holding real data.

`GET /api/workspace/institutions` lists what onboarding actually installed,
read from the database rather than from the fixture list, so the interface is
never offered a sign-in that can only 404. Both fixtures are labelled synthetic
in the stored row itself. Real institution identities, mandates, signatory
accounts and readers are onboarding data a pilot supplies; none of it is guessed
from an earlier deployment.

The four tables are also declared in `src/db/schema.ts` so `drizzle-kit` treats
them as managed rather than stray. `WORKSPACE_SCHEMA_STATEMENTS` stays the
source of truth for the two constraints Drizzle cannot express: the partial
unique index giving an account one active membership, and the composite foreign
key that makes a cross-institution session unstorable.

## Distribution certificate publication (#111)

Certificate publication uses its own service-funded relayer, not donor contributions.
Enable it only with a configured `REPORT_REGISTRY_*` mandate source and all of:
`CERTIFICATE_NFT_RPC_URL`, `CERTIFICATE_NFT_CHAIN_ID`, `CERTIFICATE_NFT_ADDRESS`,
`CERTIFICATE_NFT_RELAYER_KEY`, `CERTIFICATE_NFT_CONFIRMATIONS`, and the three budget
settings below. Keep the signing key in the server secret environment, never Git
or a `VITE_` variable. Missing/invalid settings fail startup rather than enabling
unbounded publication. With **all** `CERTIFICATE_NFT_*` settings absent, the
certificate service remains disabled.

- `CERTIFICATE_NFT_BUDGET_WEI`: positive decimal lifetime ceiling for reserved gas
  liability, in native-currency wei. This is **not** a daily allowance or measured
  gas spending; there is no automatic reset.
- `CERTIFICATE_NFT_GAS_LIMIT`: positive decimal maximum gas units per mint. Gas
  estimation must fit this limit before the transaction is signed.
- `CERTIFICATE_NFT_MAX_FEE_PER_GAS`: positive decimal EIP-1559 fee cap, in wei per
  gas. Priority fee is zero. If the network base fee exceeds the cap, publication
  may remain pending or fail; do not silently increase it during retries.
- `CERTIFICATE_NFT_CONFIRMATIONS`: positive block depth required for `CONFIRMED`.
  Choose it explicitly for the pilot chain. A later reorg can still invalidate
  that observation; physical distribution status is separate.

For example, **local synthetic tests only** use a ceiling of `1000000000000000000`,
gas limit `1500000`, and fee cap `2000000000`. Each newly signed attempt reserves
`3000000000000000` wei. These are not recommended production fee or budget values.
The operator must approve limits for the actual chain and pilot funding, including
separate provider/storage costs. Use a dedicated certificate relayer; other apps
spending from the same key are not accounted by this ledger.

### Upgrade, recovery and rollback

1. Stop certificate writers on **every instance**. Take and verify a private backup
   of the database and evidence storage, retaining frozen content/salts, intents,
   signed attempts, nonce allocation and any existing budget ledger. A signed raw
   transaction remains spendable even if RPC never acknowledged it; never publish
   these backups or transaction bytes.
2. Deploy the updated contract if the current deployment predates the receiver-
   callback fix. This contract is not an upgradeable proxy; updating backend code
   alone does not patch an already deployed NFT. Preserve the old deployment and
   its history. Do not repoint its intents to the new address: domain-bound retries
   belong to their original deployment. Stop/drain or explicitly reconcile old
   attempts before cutover; multi-deployment historical lookup is not automated.
3. Supply the three new budget values consistently on all writers using the same
   database. Startup performs additive, idempotent schema changes: the
   `certificate_service_budgets(scope,reserved_wei)` table and nullable
   `budget_scope`/`reserved_wei` columns on `certificate_attempts`. No history is
   deleted. Do not use a destructive schema push/reset to apply this migration.
4. Before the first **new** attempt, under the shared chain+relayer row lock,
   recover legacy transaction chain/sender and maximum fee liability from signed
   bytes and verify their hash. Matching liabilities are backfilled atomically
   with the new reservation, bytes and nonce. If legacy liability exhausts the
   ceiling, new publication returns 503 without signing; if legacy bytes cannot
   be verified, it also fails closed. Repair from a verified backup/reconcile with
   the responsible operator, never delete the attempts to make space. A rejected
   transaction rolls back its backfill too, so the next attempt checks it again.
5. Exact-byte retries do not reserve again. Included, confirmed, reverted and
   noncanonical attempts retain their conservative maximum reservation permanently;
   confirmation **does not refund** capacity. Explicitly approving a larger
   lifetime ceiling is the way to add capacity. Changing the contract address
   does not reset a budget for the same chain+relayer. Do not edit counters to
   match a transient receipt or restore an older database while writers are live.
6. For rollback, stop writers and retain all additive schema/data. Prefer rolling
   back UI or other services while keeping certificate writes disabled. The old
   backend has no budget enforcement: do not resume its certificate relayer.
   Restore a verified backup only after reconciling every subsequently signed
   transaction and its nonce/liability; otherwise retain the latest durable state.
   Validate a restart and same-byte retry in an isolated environment before reopening.

Verification commands from `backend/`:

```sh
bun run typecheck
bun test test/distribution_certificate_api.test.ts
REGISTRY_BROWSER_MODULE=/absolute/path/to/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
  bun test test/distribution_certificate_api.test.ts
```

These use isolated SQL storage, synthetic signatures and a local EVM. They cover
budget exhaustion/concurrency, restart/reorg, legacy accounting, tampered content
and independent chain bindings; the optional browser run also checks public
re-verification after stored content changes. No deployment or live mint is implied.

## Automated Tests vs Manual Demo

The backend pins **Bun 1.4.2** in `.tool-versions`. From `backend/`, run:

```bash
mise install
mise exec -- bun install --frozen-lockfile
mise exec -- bun run typecheck
mise exec -- bun test
```

Without mise, install the same Bun version and run those Bun commands directly.
Browser tests also require Playwright and Chromium:

```bash
REGISTRY_BROWSER_MODULE=/absolute/path/to/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
mise exec -- bun test
```

Without `REGISTRY_BROWSER_MODULE`, browser smoke tests are skipped. Bun 1.3.6
reproduced invalid SQL file descriptors after Playwright shutdown and garbage
collection; the preload rejects runtimes older than 1.4.2. The regression in
`test/browser_storage_lifecycle.test.ts` checks browser shutdown, SQL writes,
garbage collection and database restart against real PGlite storage.

`bunfig.toml` preloads `test/setup.ts` before test
imports: the suite uses the in-memory store, clears external-service credentials,
disables the embedded indexer and signing, and points RPC reads to loopback. The
database module also refuses to create a persistent client under `NODE_ENV=test`.
The normal `bun run dev` command still uses the configured demo database.

Workspace tenancy is the exception to the in-memory rule, on purpose: its suites
run against an isolated PGlite PostgreSQL (`test/helpers/workspace-database.ts`),
one data directory per test file, truncated between tests. Foreign keys, the
partial unique index and `UPDATE ... RETURNING` behave as they do in the deployed
database, and `reopen()` genuinely closes and reopens the directory — which is
the only honest way to test that a session survives a restart.

Do not use the legacy `clean-database.ts`, `clean_test_data.ts`, or
`reset-database-empty.ts` as a chain resync: they contain hard-coded seeds or
delete data that cannot be reconstructed from the contract. Back up the database
and verify the active chain/contract before any cleanup. Transactions already
recorded onchain remain part of that contract's history, even when created by tests.

### Manual Demo Snapshot (2026-09-08)

**Superseded by the subsequent full reset below.** These counts describe the
archived snapshot, not the current empty database.

The demo database was rebuilt from Arbitrum Sepolia (421614), contract
`0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b`, through block 306465379:
5 proposals, 32 fiat batches, 3 USDC deposits, 57 unique events and 8 role records.
Collected totals match the contract: IDR 483,860,000 and 300 USDC. Executed
disbursements total IDR 1,000,000 and 50 USDC. No blockchain transaction was sent.

The local, Git-ignored full backup is `demo-before-cleanup-20260908.dump.bak`
(PostgreSQL custom format, owner-only permissions). The reconstruction manifest
is `demo-rebuild-plan-20260908.json.bak`; both contain private data and must not
be published. Restoring the full backup would also restore the test pollution.

Historical fiat batches have `item_count = NULL`, not zero: donation-level
records cannot be reconstructed from a Merkle root. Beneficiary/donor names,
NIKs, receipt evidence and audit attestations were not inferred from unrelated
old rows. Auditor profiles were retained, but profiles without a current auditor
role were deactivated. Proposals 1 and 2 are Executed; 3, 4 and 5 are Pending.

The existing donation schema still stores an IDR estimate for USDC deposits
(16,200 IDR per USDC); native amounts are retained in event arguments. Do not
treat that estimate as onchain IDR or as an accounting valuation. Donation-based
period reports do not cover the historical fiat inflow after this reconstruction;
use the batch/event totals for reconciliation. AI narrative validation is a
separate concern and is not fixed by cleaning the database.

Only paid QRIS donations enter the fiat settlement queue. Automated tests remain
isolated from this manual-demo database.

### Fresh Manual-Test Reset

**Activation update:** Redeployment is now complete. Protocol
`0x0D6CeC28a574ACa41b879767b081F6f2B4E9a849`, MockUSDC
`0x1F439a83354ae624a4E8aCBC4e9873Eaa2e1f852`, indexer start `306477711`.
Local maintenance is off and one local embedded indexer is active. The reset
steps below describe the completed cutover and how to repeat it, not the current
maintenance state. See the [deployment record](../docs/deployments/2026-09-08-arbitrum-sepolia.md).

All seven tables were subsequently emptied with sequences restarted and no seed
rows. Latest pre-reset backup: `manual-reset-1788807811511.dump.bak` (private,
Git-ignored). Backend `.env` now has `DEPLOYMENT_PENDING=true` and
`ENABLE_EMBEDDED_INDEXER=false`. The API returns maintenance responses and the
frontend hides old contract data. VPS PM2 and its systemd autostart remain off.

The reset command requires the exact database host/name and creates a validated
PostgreSQL backup before truncating. Stop every writer, including remote indexers,
before running it:

```sh
bun src/scripts/reset-database-empty.ts --confirm-reset=HOST/DATABASE
```

For redeployment, compile contracts with `forge build` in `sc/`. Set
`DEPLOY_ADMIN_ADDRESS`, `DEPLOY_RELAYER_ADDRESS`, `DEPLOY_DPS_ADDRESS`, and
`DEPLOY_AUDITOR_ADDRESS` in the backend environment. Admin, DPS and auditor must
be separate wallets; the auditor cannot be the relayer. Review a dry run first:

```sh
bun src/scripts/deploy-arbitrum-sepolia.ts
```

Only an explicit `--broadcast` plus a fresh `DEPLOYER_PRIVATE_KEY` sends two
Arbitrum Sepolia deployment transactions. No mint, funding, test transaction,
database seed, or automatic config rewrite follows. Do not reuse the historical
hard-coded deployer key; it must be treated as compromised.

Before activation, update backend `ZAKAT_PROTOCOL_L1_ADDRESS`,
`SEPOLIA_USDC_ADDRESS`, and `INDEXER_START_BLOCK` to the new deployment values.
Update frontend `VITE_ZAKAT_PROTOCOL_L1_ADDRESS` and `VITE_SEPOLIA_USDC_ADDRESS`
to match, then restart/rebuild the frontend. Verify the new contract's roles,
token and zero balances/counters. Set `DEPLOYMENT_PENDING=false` and enable
exactly one indexer. Constructor role grants are indexed from the deployment
block, with a checkpoint scoped to chain ID and contract address.

Governance now sends wallet transactions, waits for receipts, then calls
`POST /api/governance/confirm`. Legacy mutation/gasless endpoints return 410.
Offchain evidence is signed by the transaction sender. Failed confirmation can
be retried in the same browser session without resending the transaction.
Wallets need testnet ETH; Pinata must be configured for real evidence uploads.
See [ADR-0019](../docs/adr/0019-receipt-verified-governance-and-clean-redeployment.md)
for the explicit change from the previous gasless design and remaining limits.

API references: [Chat completions](https://api-docs.deepseek.com/api/create-chat-completion/),
[JSON output](https://api-docs.deepseek.com/guides/json_mode/),
[thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/).
