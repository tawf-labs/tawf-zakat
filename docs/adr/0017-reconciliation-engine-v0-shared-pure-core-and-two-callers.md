# ADR-0017: Reconciliation Engine v0 — One Pure Core, Two Callers

## Status
Accepted

Pilot scope extension, 2026-09-08: [ADR-0021](0021-period-evidence-institutional-endorsement-and-private-sources.md) adds retained source snapshots and reconciliation results as part of period evidence packages. Decision 9 below describes v0; the pure reconciliation core remains applicable. This records a design decision, not an implemented schema or migration.

## Context
Two groups of users have no automated way of learning that their numbers disagree.

**Amil at BAZNAS Provinsi.** They are required to compile a **Laporan Zakat Wilayah** — a recapitulation of every Pengelola Zakat in their province (PerBAZNAS 1/2023 Pasal 6 ayat (7), due 31 January) — even though that data never passes through their hands: BAZNAS Kabupaten/Kota report directly to BAZNAS pusat through SiMBA. The recap is assembled by hand, and a discrepancy surfaces late or never.

This is not hypothetical. In BAZNAS's own **LPZN Akhir Tahun 2024**, two tables printed two pages apart — both labelled *"Sumber Data: SIMBA"*, both *"Data per tanggal 11 Februari 2025"* — report total on-balance-sheet collection for 2024 as `11,622,127,523,247` (Tabel 2.2) and `10,954,107,312,973` (Tabel 2.3). The gap is **Rp668.020.210.274**. Each table is internally consistent: its rows sum exactly to its own printed total. No per-row check would ever have caught it, because the two tables are cut along different dimensions — per jenis dana versus per jenis Pengelola Zakat — so not one row can be matched against another.

**Auditor Independen and Amil inside this protocol.** ZKT keeps two representations of the same transaction population: the indexed on-chain ledger and its PostgreSQL mirror. Nothing checks that they agree. If the indexer skips a block, fails to parse an event, or a row is written with no on-chain counterpart, nobody is told.

Per ADR-0016 this is the one feature candidate that neither SiMBA nor the incumbent commercial vendors duplicate: they all *record*, none *reconciles*.

## Decision

1. **One pure core, two callers.** `backend/src/reconciliation.ts` takes a *claim* side (the figures somebody reported) and a *source* side (the records underneath them) and returns every point where they disagree. It imports nothing from the database, `store`, `viem`, or the network — following the seam `merkle.ts` already establishes. Both modes call this one function, so a fix to the detection logic applies to both.

2. **Two modes, two route handlers, one engine.**
   - **Mode Antar-Lembaga** (`POST /api/reconciliation/antar-lembaga`) — stateless. Claim = one consolidated Laporan Zakat Wilayah; source = the N Laporan Kinerja underneath it.
   - **Mode Internal** (`POST /api/reconciliation/internal`) — the caller uploads nothing. The server builds the claim side from PostgreSQL (Merkle batch settlements, the fiat donations rolled into each, disbursement proposals and executions) and the source side from indexed events, then calls the same engine. `backend/src/reconciliation-internal.ts` owns that mapping and is itself pure — it takes rows, not a database handle.

3. **Money is an integer, never a float.** `bigint` throughout: IDR in whole rupiah, USDC in 6-decimal minor units. National totals sit at the order of 10^13 and must not depend on `Number.MAX_SAFE_INTEGER`. Amounts cross the wire as decimal strings in both directions.

4. **Adding across units is an error, not a conversion.** There is no rate and no oracle, consistent with the Multi-Unit Ledger architecture. Mode Internal therefore produces one report per unit.

5. **Matching is on `(key, bucket, balanceSheet)`**, never on `key` alone — one Pengelola Zakat has many jenis dana rows. `delta` is always signed and always reads claim minus source.

6. **On and off balance sheet are reconciled separately.** A gap on one must never be cancelled by a gap on the other; the interface runs both positions and shows them as separate results.

7. **Totals are checked three ways.** A side's declared bucket total against its own entries; its declared grand total against its own entries; and — the only comparison that survives incomparable bucket dimensions — the grand total each side prints against the other's. Total-class findings are reported alongside entry-level ones but stay out of `netDelta`, because the entries beneath them are already counted there.

8. **Strict vocabulary by default, widened only on request.** The bucket dimension defaults to the five jenis dana of PerBAZNAS 1/2023, so a typo is refused by line rather than quietly becoming a legal bucket. A report cut along another dimension declares that explicitly.

9. **Stateless in v0.** No new tables, no Drizzle migrations, no stored history. The engine computes and returns. This lets it be tested against real LPZN figures and demonstrated to partner institutions before the storage schema is locked.

10. **The LPZN 2024 case is a fixture, not a slide.** `backend/src/fixtures/lpzn-2024.ts` carries Tabel 2.2 and Tabel 2.3 transcribed from the official PDF, and the test suite asserts the gap is exactly `668_020_210_274`. It is simultaneously a regression test against real data and the demo asset.

11. **Ceiling compliance is separate from arithmetic agreement** (spec #55 US-23). Each uploaded collection entry may carry `amilAmount`, in the same unit as its collection amount. The engine groups collection and hak amil by `(PZ key, balanceSheet)` across funds, excluding declared totals. It checks each side independently against 12.5%, using the same integer policy as ADR-0018. One PZ or balance sheet position cannot subsidise another's ceiling, and reconciliation tolerance cannot hide a violation. `balanced` retains its arithmetic meaning; `amilAssessment` reports `WITHIN_CEILING`, `EXCEEDED`, or `NOT_CHECKED`, with exact amounts and reasons per scope. Missing hak amil, duplicate entries, or an empty population never earns a ceiling pass. Both modes display this assessment and include it in downloads even when no monetary discrepancy exists; discrepancy filters never remove ceiling findings.

    The internal mapper supplies a separate `amilBasis` because its batch, donation, proposal and execution streams cannot all be summed as collection. For IDR, the denominator is settled batches counted once; the numerator is executed AMIL proposals in that same reconciliation snapshot. This is a snapshot check, not a lifetime contract invariant or the differently scoped period report. Unknown asnaf or duplicate basis rows makes the check unavailable. The chain-side execution events lack asnaf and the USDC deposit mirror lacks native amounts, so those scopes explicitly remain `NOT_CHECKED`. External HTTP callers cannot upload `amilBasis` to replace the denominator derived from their entries. No schema changes are needed.

## Consequences

### Positive
- The detection logic is a pure function with no I/O, so its whole behaviour is testable in milliseconds and deterministic by construction.
- Both modes share one core: improving discrepancy detection improves the auditor's internal check and the province's inter-institution check at once.
- The engine finds a real Rp668 billion gap in an official BAZNAS publication — evidence on live data rather than invented data.
- No schema change means v0 can ship and be demonstrated before the storage shape is decided.

### Negative / Known limits
- **USDC deposits are not reconciled per deposit.** A USDC row in `donations` stores an *estimated* IDR value and no transaction hash, so it cannot be tied to its `USDCDeposited` event. Closing this needs columns that v0's no-migration constraint rules out. _Closed post-v0 by [ADR-0025](0025-usdc-deposit-identity-and-native-amount-storage.md) (ticket #67), which narrows decision 9 rather than replacing it: the no-migration boundary still holds for the v0 engine and its callers._
- **A narrowed block range bounds the chain side only.** Database rows carry no block number, so rows outside the range would read as `MISSING_IN_SOURCE`; the endpoint returns an explicit `scopeWarning` and points at the reporting period, which bounds both sides symmetrically.
- **Results are not stored.** Every run is recomputed, and there is no history to compare across time.
- **No tenant separation or authentication in v0**, so the inter-institution endpoint works on whatever the caller uploads.
- **Hak amil coverage depends on the available evidence.** Old uploads and the LPZN fixture contain no hak amil values; internal chain-side events contain no asnaf, and internal USDC collection is not available in native units. These scopes report `NOT_CHECKED`, not zero or a pass. An uploaded hak amil amount is still a declaration, not proof of payment. The internal check inherits the reconciliation snapshot's date/block limits above; it is not the contract's lifetime accounting.

## References
- Spec: GitHub issue #55; tickets #56–#60
- Evidence: `docs/research/0002-baznas-pelaporan-audit-dan-ai.md` §5 (data quality), Lampiran A (how to re-verify every figure)
- Strategy: `docs/strategy/README.md` §6 (first release on the roadmap), ADR-0016 (technology vendor positioning)
- Related: ADR-0006 (separation of DPS and Auditor powers), ADR-0008 (embedded indexer), ADR-0012 (feature-driven frontend)
- Hak amil contract, verification, and remaining coverage: `docs/verification/0055-amil-ceiling.md`; native USDC deposit follow-up: #67.
