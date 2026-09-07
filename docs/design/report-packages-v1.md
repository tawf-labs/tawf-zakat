# Snapshot report packages — ticket #71

The private workspace now prepares reports from a stored evidence snapshot through
`report-package.ts`. It recomputes reconciliation and supported figures from the
verified canonical snapshot; stored result JSON and caller verdicts are not inputs.
The HTTP boundary is `/api/evidence/:preparationId/reports`:

- `GET /review`: figures, source disclosure, limitations, prerequisites and policy.
- `POST /`: save a human or AI draft and its deterministic verdict, including rejection.
- `GET /`: list saved package identities; `GET /:id`: read the original package.
- `POST /:id/freeze`: create an immutable frozen package, preserving the draft.
  Repeated freezing of the same draft returns the same frozen identity.

All routes require current institutional workspace membership. Only OFFICER can
prepare or freeze. Readers can inspect packages in their institution. There is no
public route for the report body, private source labels, disclosure or salt.

## Supported policy

`reconciliation-snapshot-v1` requires both readable sides with matching institution,
period, scope, units and cut-off. Every supported figure is a mandatory exact claim.
The required disclosure carries source status, transaction-detail declarations,
findings and limitations. It must match the snapshot-derived disclosure. Duplicate
keys and inconsistent declared totals block a passing draft. Correctly disclosed
cross-side differences do not. Reconciliation tolerance remains bound in the snapshot
and public summary; it never becomes claim tolerance.

Figures describe each ledger side's total and the fund/position combinations declared
by its manifest. A readable empty side can contribute zero; unread sides contribute
no figures. Generic ledger rows cannot establish collections versus distributions,
asnaf or event durations. These dimensions remain unavailable, even if a manifest
says transaction detail exists. The narrative validator scans rupiah-shaped amounts;
it does not certify sentence semantics or nonmonetary narrative numbers.

Hak amil is explicitly unexamined unless server onboarding sets
`REPORT_AMIL_RULES_JSON`, for example the following **synthetic** configuration:

```json
[{"institutionId":"lpz-sinar-amanah","version":"synthetic-policy-v1","basis":"SOURCE_COLLECTION_ROWS","fundType":"ZAKAT","ceilingBps":1250}]
```

The configured basis declares that SOURCE rows for that fund are collection amounts.
All such rows must have amil amounts. The service computes totals and checks the
ratio by integer cross multiplication. Other funds do not inherit that ceiling.
Missing basis data or a policy violation blocks the draft. This example is not a
legal determination or a policy for a real institution. Configuration is server-only;
caller-supplied `withinCeiling`, figures, policy or passing flags are rejected.

Human drafts and AI output pass through the same validator and package prerequisites.
AI errors become a saved absent draft with rejected status; upstream error bodies,
credentials and provider details are not returned. No signature is issued by this ticket.

## Canonical format and verification

`format: tawf.report.package`, `serializationVersion: 1` binds institution, report,
version, predecessor/reason, full snapshot, snapshot commitment, computed figures,
reconciliation, findings, policy, draft, verdict, disclosure, limitations, AI failure
state and an allowlisted public summary. `DRAFT` and `FROZEN` have distinct identities.
Corrections must reference another frozen version of the same report and institution.
This is a preparation relationship, not a claim of canonical onchain publication.

Serialization uses `shared/canonical-json.ts` in both backend and browser:

- Keys sort by JavaScript UTF-16 code-unit order; no incidental property order matters.
- Arrays preserve order. Source rows, draft claims and findings retain their recorded
  order; generated figure names sort lexically. Reordering an array changes its digest.
- Narrative and source text preserve Unicode code points, whitespace and line endings:
  no NFC/NFD, newline or typography normalization. Identity fields trim surrounding
  whitespace at input; those resulting stored strings are what is committed.
- Optional package predecessor/reason are explicit `null`; missing draft/disclosure
  is `null`. Absent properties are distinct from null. `undefined` is rejected.
- Money is a canonical signed decimal integer string after bigint conversion, without
  grouping, leading zeros or negative zero. Safe integer metadata is JSON numeric.
  Floating-point metadata and raw bigint are rejected by the serializer.
- UTF-8 canonical bytes are committed with HMAC-SHA256 using the preparation's
  restricted 32-byte salt. `digest` is an envelope field, excluded from its own body.
  Salt is available only to authorized readers through the preparation endpoint.

`shared/fixtures/report-serialization-v1.json` contains independently generated Python
HMAC vectors for optional fields, array order, Unicode/newlines and large/negative
integer strings. Backend crypto and browser WebCrypto both consume them. The browser
verifies a saved package before displaying its review.

Freezing checks original file availability and plaintext digests. Rejected drafts can
be frozen as examination evidence but are never shown ready for publication endorsement.
A passing frozen draft is ready for the later endorsement workflow, not published.
Downloads are explicitly marked restricted drafts and include claims and limitations.

## Storage and local verification

The existing additive `ensureSchema()` migration adds `report_packages` and a composite
foreign key to the preparation's institution. Package writes are atomic, insert-only
at the application boundary, and reads are institution-scoped. Existing snapshot tables
and legacy records are preserved. Back up the database and encrypted file directory
with its separately held key before applying schema changes in a managed environment.
Recovery uses the original database/file/key backup; do not re-create lost evidence
or backfill endorsements. No production migration or deployment is performed here.

Verification: HTTP `app.fetch` with real reconciliation/validator and disk-backed
PGlite, including reopening the database; shared serialization vectors with both crypto
implementations. Registry ABI, signatures and canonical published-version arbitration
belong to subsequent tickets; this implementation changes no contract.

Validation recorded during implementation: 52 evidence HTTP tests and 23 shared
snapshot/browser-vector tests passed; the complete frontend suite passed 133 tests
and the production build passed. The complete backend suite had 455 passes and 22
failures; the same failure set was reproduced on starting commit `67ce08c` (440
passes, 22 failures), including legacy external-service assumptions and the WebSocket
port fixture. Typechecking retained the baseline's 14 backend and 138 frontend
errors, with no newly introduced diagnostics. The unchanged contract suite passed
65 local tests plus two RPC fork tests after a network-enabled retry. Standards and
spec reviews found a balance-sheet scope bug in totals/amil calculations; it was
reproduced through HTTP, fixed, and regression-tested. No remaining review findings.
