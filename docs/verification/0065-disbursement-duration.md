# Ticket 65 Verification

Date: 2026-09-07. Spec: #61. Implementation baseline: `72eddf3`.

## Result

The interrupted duration feature is complete locally. Period reports include
five intervals across the four authority stages, measured sample counts,
exclusions by reason, expandable trails, block links, and the same details in
the downloaded report. Duration claims use the existing deterministic validator.
No schema, table, column, or migration was added.

DPS timestamps remain unavailable. Approval block markers require indexed
quorum evidence (`currentApprovals >= 2`); the Amil's initial approval is excluded.
The slowest interval is selected using exact elapsed milliseconds over identical
populations and non-overlapping intervals. Exact ties produce no unique winner.

## Checks

- Backend report/duration suite: 104 passed across six files, without database
  credentials or model credentials. Includes both HTTP endpoints.
- Entire frontend test suite: 96 passed across seven files.
- Backend and frontend production builds passed.
- Full backend suite was run: ten failures also reproduce on baseline `72eddf3`.
  These cover auditor authorization, role persistence, live relayer operations,
  WebSocket binding in the sandbox, and internal reconciliation without a DB.
- Typechecking reports the same diagnostics on baseline and implementation:
  139 frontend errors and ten backend errors. No additional diagnostics.
- Chromium checks at 1440x1000 and 390x844 passed: real local HTTP figures,
  missing-model handling, rejection of an incorrect draft, and no horizontal
  overflow. A response generated from explicit fixture rows exercised the open
  trail, explorer links, successful download, and rejected-draft download gate.
- An existing hydration warning from `SafeConnectKitProvider` appears during
  browser startup; the checked workflows work after hydration completes.
- Parallel Standards and Spec reviews identified incorrect approval evidence
  and rounding in the slowest-stage comparison. Both were fixed with regression
  tests and cleared in targeted re-review. The duplicated attestation predicate
  was consolidated into the shared ledger reader.

Run the focused backend checks from `backend/`:

```sh
env DATABASE_URL= ANTHROPIC_API_KEY= ANTHROPIC_AUTH_TOKEN= NODE_ENV=test \
  ENABLE_EMBEDDED_INDEXER=false bun --no-env-file test \
  test/disbursement_duration.test.ts test/period_report.test.ts \
  test/report_validator.test.ts test/report_drafter.test.ts \
  test/period_report_api.test.ts test/period_report_draft_api.test.ts
```

Run `bun test` and `bun run build` from `frontend/`, and `bun run build` from
`backend/`. Keep the full legacy backend suite sandboxed: some tests still attempt
live RPC calls even with credentials omitted.

## Deployment Ticket 66

Production checks still return HTTP 404 for:

- `https://tawf-zakat.vercel.app/laporan-periode`
- `POST https://api.tawf.my.id/api/period-report/verify`

The authenticated Vercel account contains project `tawf-zakat`. Backend SSH access
through the existing `tawf-labs` host configuration rejects both the local user
and the root user with `Permission denied (publickey)`. A working SSH user/key
configuration is needed to inspect and update the deployed backend. Nothing has
been deployed or pushed as part of this verification.

Before deployment, inspect backend startup: `backend/src/db/index.ts` already
executes schema initialization DDL when a database is configured. Ticket 66's
no-migration requirement needs an explicit deployment treatment of that existing
behavior. Confirm the server-side model credentials, deploy both applications,
then verify the public routes, the LPZN golden case, and a deliberately rejected
draft. Local verification does not complete ticket 66.
