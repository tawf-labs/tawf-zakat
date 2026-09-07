# #55 - Hak Amil in Reconciliation

Verified locally on 2026-09-07 against baseline `8c8421e`.

## Contract and Scope

- Collection entries accept optional `amilAmount`, encoded as the same decimal-string Money shape as `value`. Omission means unavailable, not zero. A sixth column in pasted/uploaded text carries that row's hak amil; legacy three-to-five-column input remains supported.
- Each side is assessed independently, grouped by PZ key and balance sheet position across its funds. Declared totals do not enter the denominator. Units never mix. Uploaded amounts remain declarations, not evidence of payment.
- `balanced` describes agreement of collection/ledger values. The separate `amilAssessment` has `WITHIN_CEILING`, `EXCEEDED`, or `NOT_CHECKED`, plus exact collection, actual allocation, ceiling, and reasons per scope. Reconciliation tolerance and discrepancy filters cannot suppress ceiling findings.
- Empty or incomplete populations and duplicate collection rows do not receive a ceiling pass. Conflicting duplicate rows also leave the collection basis and ceiling unavailable, independent of input order.
- Internal IDR uses settled batches once and executed AMIL proposals in the same snapshot. Unknown asnaf or duplicate basis rows prevents assessment. Chain-side execution events lack asnaf; the USDC mirror lacks native deposit amounts. Those scopes remain explicitly `NOT_CHECKED`.
- Internal responses carry the requested `period`, or `null` when no period filter was applied. The latter is displayed/exported as an unfiltered snapshot, never as the legacy report object's fallback year. CSV includes block coverage and scope warnings.
- Both modes display and export the assessment even when monetary differences are zero. The period report and reconciliation share the integer ceiling policy, not their transaction populations.
- No schema changes, migrations, transactions, or production deployment. Native USDC deposit reconciliation is tracked separately in [#67](https://github.com/tawf-labs/tawf-zakat/issues/67).

Example input for a one-rupiah violation with no collection discrepancy (use for both sides):

```csv
Kode PZ;Nama;Jenis dana;Posisi;Pengumpulan;Hak amil
PZ-1;BAZNAS Kab. Kampar;Zakat;on;100.000.000;Rp12.500.001
```

Expected: collection `100000000`, ceiling `12500000`, actual `12500001`; monetary delta zero, ceiling status `EXCEEDED`.

## Verification

- Focused backend: **146 passed, 0 failed** across reconciliation core/totals/amil, internal mapper and HTTP, period figures, validator, and period-report endpoints.
- Entire frontend suite: **103 passed, 0 failed**, including parsing, precision, unknown-status compatibility, unfiltered internal scope, and CSV findings surviving discrepancy filters.
- Entire backend suite: **234 passed, 9 failed**. Baseline: **219 passed, 10 failed**. All remaining failures also occur at baseline: auditor/gasless governance authorization, indexer role persistence, network-dependent relayer/batch operations, and sandbox WebSocket binding. The baseline empty-USDC-report failure is fixed by retaining the requested currency when neither side has entries.
- Typechecks remain nonzero but diagnostics match baseline exactly: **139 frontend, 16 backend**. No new diagnostics from this work.
- Frontend and backend production builds pass.
- Playwright with actual local API at desktop `1440x1000` and mobile `390x844`: exceeded, exact-ceiling, and missing-data states; both CSV downloads; the LPZN `668020210274` golden case; unfiltered internal scope; no document-wide horizontal overflow. Ceiling table scrolls within its region on small screens.
- Existing SafeConnectKitProvider hydration mismatch remains on initial navigation. A repeat run during a build also observed a React concurrent-render recovery; the isolated rerun passed all checks on both viewports. Console output still includes the existing external payment-script CSP warning.
- Local screenshots: `/tmp/zkt-55-desktop.png`, `/tmp/zkt-55-mobile.png`. Browser script: `/tmp/zkt-55-browser-check.ts`. Full test/typecheck/build logs: `/tmp/zkt-55-*.log`.

## Review

Standards: header misclassification and empty internal basis findings resolved with regressions; no open findings in the re-review.

Spec: duplicate-basis order dependence, header misclassification, and unfiltered snapshot year-label findings resolved with regressions; no open findings in the re-review.

Preview: `http://127.0.0.1:3002/rekonsiliasi`, API `http://localhost:3003`. The API runs without database, AI, payment, or signer credentials; it is not a production-data verification.
