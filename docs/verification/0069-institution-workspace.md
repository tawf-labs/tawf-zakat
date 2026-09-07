# Ticket 69 Verification

Date: 2026-09-08. Spec: #68. Implementation baseline: `6a283c5`.

## Result

An institution workspace with isolated access exists locally. An officer opens
it by signing a single-use challenge that binds the application purpose, the
account and a closing time; the account is proved by EOA recovery or by an
ERC-1271 contract account, and the address in a request body is never accepted
as identity on its own. The institution a caller acts for is read from their
membership. A request naming a different institution is refused rather than
re-pointed, so editing a payload moves no ownership.

Two synthetic institutions ship as fixtures, both labelled synthetic in the
stored row itself. No partner identity, mandate, signatory key or account was
guessed from an earlier deployment; those remain onboarding configuration that
a pilot supplies before real use.

Storage is additive: four new tables, no ALTER on any existing table, and no
backfill. A donation recorded before institutions existed belongs to no
institution, and nothing in onboarding adopts it into one.

Authority here governs the workspace only. Recording evidence and publishing a
report stay the registry's to authorize onchain (ADR-0022); no membership row is
consulted as a fallback for a role the chain refuses.

## Where the rules live

- `backend/src/tenancy.ts` — pure core: challenge minting and judging, tenant
  resolution, role capabilities. No database, clock, network or RPC.
- `backend/src/account-signature.ts` — EOA recovery and the ERC-1271 rule. The
  only seam is `EthCall`, one `eth_call`; the digest, the calldata, the magic
  value and every failure rule run for real.
- `backend/src/tenancy-store.ts` — the adapter, plus the constraints a pure
  function cannot express (see below).
- `backend/src/routes/workspace.ts` — `/api/workspace`: `POST /challenge`,
  `POST /session`, `GET /`, `DELETE /session`, `POST /members`,
  `GET /institutions`.
- `frontend/src/features/workspace/` and the `/ruang-kerja` route.

## What the database refuses, not merely the route

- A membership must name an institution that exists (foreign key).
- One account is active in at most one institution (partial unique index on
  `account_address WHERE is_active`). Deactivated rows are kept, so rotation
  preserves history rather than deleting it.
- A session may exist only for a real `(institution, account)` membership pair
  (composite foreign key). A cross-institution session cannot be stored at all.
- A challenge is spent by one conditional `UPDATE ... WHERE consumed_at IS NULL`,
  so two requests racing for the same nonce cannot both win.

## What the two-axis review changed

Both review axes ran before this was committed. The findings that mattered:

- **Onboarding never actually happened.** `upsertInstitution` had no production
  caller, so on a real local run the `institutions` table stayed empty and
  `POST /challenge` answered 404 for the very ids `GET /institutions`
  advertised. Fixed by `bun run seed:workspace` (`src/scripts/seed-workspace.ts`),
  which installs both institutions and their accounts — an initial
  administrator, an Amil operasional, a reader — and refuses a non-local
  `DATABASE_URL` without `--force`. `GET /institutions` now reads the database
  rather than the fixture list, so an advertised id is always one a challenge
  can be minted for.
- **The nonce was spent before the signature was checked.** Anyone who learned a
  nonce could burn a legitimate officer's challenge with garbage. The challenge
  is now read, judged and verified first, and spent only after the signature
  proves the caller. Single use is still settled by the conditional `UPDATE`,
  which is the only place it can be atomic.
- **The `purpose` column was decorative.** `consumeChallenge` rebuilt it as a
  constant, so the stored value never entered the check. It is now read back and
  compared, and a row minted for anything else cannot open a session.
- **Four tables were invisible to `drizzle-kit`.** A later `push` would have
  seen them as unmanaged. They are declared in `src/db/schema.ts`; the raw DDL
  stays the source of truth for the partial index and composite foreign key.
- **`POST /members` let an administrator mint another administrator.** #68
  requires a successor to accept the authority, which is #77's work, so the
  route now refuses `ADMIN` outright.
- Smaller: a dead `? 403 : 403` ternary; `judgeChallenge`'s `consumed` parameter
  that production always passed `false`; test-only introspection (`columnsOf`,
  `rowCount`, `memberCount`) shipped in the production store, now in the test
  helper; a `requireCapability` that only delegated; a nonce typed as `Address`;
  five copies of the runtime guard, now one middleware; a 503 message telling
  operators to run a migration the server runs itself; `evidencePackages: []`,
  which was #70 surface and is gone.
- **Refusal wording**: the server's message now wins on the client, with the
  frontend map as fallback, so the two vocabularies cannot contradict each other
  in front of a reader.
- **UI behaviour**: #68 forbids adding a frontend test framework for this spec,
  so the sign-in walk was extracted to `workspaceAccess.ts` behind ports and
  tested there — order of operations, `bigint` conversion, the server-minted
  nonce going back unchanged, a refused challenge never reaching the wallet, a
  dismissed wallet, and a server refusal.

## Checks

- New suites: 81 passed across four backend files (`tenancy`,
  `account_signature`, `workspace_store`, `workspace_api`) and 17 across two
  frontend files (`workspaceSession`, `workspaceAccess`).
- The hand-written ERC-1271 calldata is cross-checked against viem's own
  `encodeFunctionData` at ten signature lengths, including ones that do not fill
  a 32-byte word.
- Persistence is verified against an isolated PGlite PostgreSQL, one data
  directory per test file, truncated between tests. Foreign keys, the partial
  unique index and `UPDATE ... RETURNING` are the real thing; `reopen()` closes
  the database and opens the same directory again, so the durability claims
  (a session and a spent challenge surviving a restart) mean what they say.
- Only two things are substituted in the API tests: the clock, and the `eth_call`
  transport. The stub answers the way a node does — an address with no code
  returns empty data — so an EOA can never be admitted through the contract
  path. The signature arithmetic, challenge rules, tenant resolution and every
  gate run for real.
- Full backend suite: 346 passed, 20 failed. The 20 failures reproduce
  identically on baseline `6a283c5` (verified in a clean worktree; the grouped
  failure sets are byte-identical). They cover the governance simulation routes
  that commit `6a283c5` deliberately disabled with 410, plus relayer and indexer
  operations that need live credentials. None involve this ticket's modules.
- Frontend suite: 120 passed across nine files. Production build passes.
- Typechecking adds no diagnostics. The pre-existing errors in `db/index.ts`,
  `indexer.ts`, `ipfs.ts`, `scripts/` and the unused-import warnings in
  `Navbar.tsx` are unchanged; the new backend and frontend modules are clean.

## Acceptance cases covered

Valid access; an account nobody onboarded; a signature valid but over somebody
else's challenge; an address asserted with no signature; challenge replay;
an expired challenge; an unknown nonce; a session past its window; sign-out
followed by reuse; a token nobody issued; no credential at all; a payload and a
query string naming another institution; a reader refused any change; an officer
refused an administrator's power; ERC-1271 accepted when the contract approves
and refused when it declines, with no fallback to recovery.

## Limits, stated plainly

- `POST /members` is the only write this ticket gates at the API, because it is
  the only write this ticket has, and it refuses `ADMIN`: the initial
  administrator comes from onboarding, and rotation with successor acceptance is
  #77's. The `prepareEvidence` capability is proved at the pure core and carried
  in the workspace response; the routes it will gate arrive with #70.
- The ERC-1271 path is exercised against a stubbed transport, not a deployed
  contract account. A local EVM journey covering the real thing belongs with the
  registry work in #72–#73.
- The workspace response carries no evidence field at all. A placeholder empty
  list would have been #70's surface arriving early, and could be misread as a
  claim that evidence was looked for and found absent.
- The React components (`WorkspacePanel`, `useWorkspace`) have no component
  test. #68 rules out adding a frontend test framework for this spec, so the
  logic worth testing was moved out of React instead of testing React.
- The synthetic fixtures are labelled synthetic. Nothing here indicates a partner
  is onboarded, and no production database or deployment was touched.
