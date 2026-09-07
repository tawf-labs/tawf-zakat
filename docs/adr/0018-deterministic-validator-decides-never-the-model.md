# ADR-0018: A Deterministic Validator Decides, Never the Model

## Status
Accepted

Updated 2026-09-07: at the user's request, the demo uses DeepSeek instead of
Anthropic. This replaces the original provider choice in decision 9, not the
deterministic validation policy.

## Context
An Amil compiling a period report does two jobs, and only one of them is worth a human's hours.

The first is **the numbers** — collection per jenis dana, distribution per asnaf, the hak amil share against its ceiling. Those already exist in the ledger, yet they are copied out and re-added by hand.

The second is **the sentences** — the narrative that makes the figures readable by a pimpinan, a DPS, an auditor. That takes hours per period and adds no new truth to the report.

Handing the second job to a language model is the obvious move, and it is the move every AI reporting tool in this market has already made. It trades *a human mistypes a figure* for *a machine invents one*, and the second is worse: the invented figure arrives inside a fluent, confident sentence, and nothing downstream is built to doubt it. Meanwhile the first problem — nobody can prove the figures in a report came from the records underneath it — stays exactly where it was. That is not hypothetical either: two tables two pages apart in BAZNAS's own LPZN Akhir Tahun 2024 disagree by Rp668.020.210.274 (see ADR-0017).

So the question this work answers is not *can a model write the narrative* — it plainly can — but **what decides whether the result may be signed.**

## Decision

1. **The model is never the last step, and its output is never trusted.** A draft is produced, then checked, then read by a human, then signed. Nothing skips the check. This ADR shapes every AI feature that follows in this codebase: a model may propose, it may never certify.

2. **A deterministic validator decides.** `backend/src/report-validator.ts` is a pure function from `(period figures, draft) → verdict`. No model, no network, no clock, no randomness. Who wrote the draft is not part of its input, because who wrote it has never been what makes a number true. The same draft always earns the same verdict, and the verdict is reproducible by anyone holding the same ledger.

3. **A draft is two parts, separated hard.** A **claim list** (figure name → value) and a **narrative**. This separation is a decision, not a convenience: it turns checking numbers into exact matching rather than reading prose for meaning.

4. **Three checks, all deterministic.**
   - **Claim match** — every claimed figure must exist among the computed figures and equal it exactly, unit included. There is no rounding tolerance; a zakat report does not do "about".
   - **Narrative leak** — every rupiah-shaped number in the narrative must appear among the claims that *passed* the first check. This is what catches an invented figure smuggled into the middle of a sentence. A failed claim never licenses the number it claimed.
   - **Invariant** — the hak amil share must not exceed the 12,5% ceiling, read off the ledger rather than off the draft, so a draft cannot pass by reporting a violation accurately. The same `MAX_AMIL_BPS = 1250` the contract locks is now also enforced in the IDR period report. This verdict does not assess the separate reconciliation inputs from ADR-0017; those now have their own assessment, sharing only the integer ceiling policy in `amil-policy.ts`.

5. **Pass or reject, with no warning level.** A draft is signable or it is not. A warning is only a rejection that somebody in a hurry talks past. Every finding names the figure, the value claimed, and the value it should have been — enough to fix it rather than guess at it.

6. **The figures are computed before the draft exists, and are the only figures claimable.** `backend/src/period-report.ts` takes rows and a reporting period and returns every figure under a stable machine name. It is pure — rows, not a connection — following the seam `merkle.ts` and `reconciliation.ts` already establish. This is also the boundary that lets the drafting step be replaced, or fail entirely, without touching the arithmetic.

7. **A verdict never depends on the order the claims were written in.** Claims are grouped by figure name before anything is judged, and findings are returned in a fixed order. A figure claimed twice yields one finding about the name rather than a finding about whichever copy arrived first.

8. **An undated row is counted in no period rather than in every one.** `backend/src/ledger-rows.ts` distinguishes `INSIDE` / `OUTSIDE` / `UNDATED` because the two callers want opposite things from the third case: reconciliation must never let a period filter hide a row, since an unseen row is an unreported discrepancy; a period report must never count one, since a row with no usable date would otherwise appear in every period. Nothing disappears quietly — the number of rows left out is itself a reported figure.

9. **The drafting step is a direct call, not an abstraction.** `backend/src/report-drafter.ts` calls DeepSeek's `/chat/completions` with native `fetch`, defaulting to `deepseek-v4-flash`, `thinking: { type: "disabled" }` and `response_format: { type: "json_object" }`. JSON mode guarantees neither our schema nor truthful claims: the prompt includes the schema and a JSON example, Zod checks the returned structure, and only then does the deterministic validator judge the numbers. This uses the existing HTTP and Zod primitives without a provider interface or SDK. `DEEPSEEK_API_KEY` stays in the server environment; optional `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` override the defaults. Legacy Anthropic settings are ignored. A 30-second timeout covers the request and response reading, output is capped at 4,096 tokens, and no automatic retry or fallback provider adds latency or cost. The call format is checked against the current DeepSeek API reference linked below.

10. **A drafting failure is never a request failure.** The figures are computed before the model is asked, so a missing key, insufficient balance, rate limit, timeout, refusal (`finish_reason: "content_filter"`), incomplete completion, or malformed response all resolve the same way: the figures are returned, and the absence of a narrative is stated in the open rather than disguised as an empty report. Only a completed response (`finish_reason: "stop"`) with a valid schema and nonblank narrative is used. Upstream error bodies and exception details are never reflected to the browser. `draftReport` never throws.

11. **A rejected draft is returned, not hidden.** The response carries the figures, the draft, and the verdict together, whatever the verdict says. A reader is entitled to see what was refused and why — hiding a rejected draft would make the validator unfalsifiable. This extends to a draft the reader cannot even parse: a claim whose amount arrives as `"100.000.000"` rather than `"100000000"` is carried through as an *unreadable* claim and rejected by the validator (`KLAIM_TIDAK_TERBACA`), rather than discarded as though the service had been unreachable. Two things follow. Reinterpreting those digits would be the system inventing the very figure it exists to check; and reporting a bad draft as an outage would hide the one event the product is built to show. It is also the likeliest slip the model will make, since it is told to write rupiah as `Rp1.500.000` in the narrative.

12. **From the test suite's point of view there is no AI.** There is only a draft, and the tests write their own, including the deliberately wrong ones. Drafting tests stub the HTTP boundary with fake credentials and completions, exercising the real request shape, parsing, error handling and deterministic validator without a live AI service or real API key.

13. **Stateless, again.** No new tables, no Drizzle migration, no stored report history. Figures are computed and returned. Deploying this touches no data.

14. **One wire codec, shared.** `backend/src/wire.ts` owns decoding and encoding for money and reporting periods, used by both the reconciliation and period report routes. Amounts cross the wire as decimal strings in both directions so trillion-scale rupiah survives JSON exactly, and units are refused by name rather than silently defaulted.

15. **Duration is a period figure like any other, and a block number is not a clock** (ticket #65). `backend/src/disbursement-duration.ts` turns the timestamps and indexed block numbers this system already stores into a stage-by-stage trail per disbursement, under the four stages ADR-0006 separates: pengajuan, persetujuan DPS, eksekusi, atestasi. The averages become period figures in a new `JAM` unit, so a claim about how fast the lembaga works is checked by exactly the same validator that checks a rupiah figure.

    Four states, kept apart because they mean different things to a reader: `SELESAI` (both ends dated), `BELUM_SELESAI` (the stage has not been passed), `TIDAK_TERCATAT` (it was passed but left no readable wall-clock), and `URUTAN_TERBALIK` (timestamps contradict the stage order). **An unmeasured span is never published as zero hours** — zero would read as instant, which is the opposite of the truth. An average is only published where at least one sample exists; the sample count and exclusions by reason are published for every span, including the empty ones.

    Persetujuan DPS is the standing `TIDAK_TERCATAT` case and the reason this decision is worth recording. The approval happens on chain and is indexed with its block number, but no approval timestamp column exists and this work adds no migration. A block number fixes the *order* of events; it is not a clock, and `onchain_events.created_at` is when the indexer wrote the row — accurate for a live poll, arbitrarily wrong for a backfill. Deriving an approval time from either would be the system inventing the very figure this feature exists to catch, so it reports the gap instead.

16. **Durations are measured over the same population as the amounts beside them.** The trails cover exactly the disbursements the penyaluran figures describe: executed, inside the period. A duration drawn from a different population than the money next to it would be two reports in one document.

17. **The slowest stage requires comparable samples.** Compare only non-overlapping intervals measured from the same disbursements. Without a DPS timestamp, compare pengajuan-to-eksekusi against eksekusi-to-atestasi. If their measured populations differ, publish their averages and counts but name no slowest stage. An attestation received after the reporting period remains the end of that disbursement's duration, so a later report can include newly completed measurements.

## Consequences

### Positive
- An invented figure cannot reach a signature: it is caught by exact match, or by the narrative scan, or the report is not signable.
- The check is a pure function, so its entire behaviour is testable in milliseconds and reproducible by a third party.
- The hak amil ceiling is now enforced in the IDR period report as well as in the contract; a reconciliation result is not covered by this verdict.
- The demo is the product: a draft with a wrong figure is rejected by the system's own rule, in front of whoever is watching.
- Swapping or losing the drafting step changes nothing about the arithmetic.

### Negative / Known limits
- **The validator checks numbers, not adjectives.** A narrative that misstates a trend without naming a figure passes. This is exactly why a human still reads and signs.
- **`donations` carries no jenis dana column** and this work adds no migration, so every fiat donation counts as ZAKAT and the other four jenis dana report zero. The structure follows PerBAZNAS 1/2023; the split does not yet.
- **USDC donations are reported on their own line** as an estimated rupiah value at a fixed rate, never added into collection per jenis dana — the same limitation ADR-0017 records.
- **An asnaf label outside the known table lands in `LAINNYA`** rather than being guessed into one of the eight.
- **Rupiah detection is shape-based.** It catches an `Rp` prefix, digits grouped in thousands, and a run of digits the sentence itself calls rupiah or IDR. Two consequences: "Rp1,5 miliar" is read as the number 1 and rejected as unclaimed, and an invented figure written as bare ungrouped digits with no `Rp` and no unit word ("dana sebesar 888000000") is not seen at all. Drafts are expected to write figures in full digits with the `Rp` prefix; the claim list, not the scan, is the primary defence.
- **The hak amil ratio is floored to whole basis points**, so 12,50009% publishes as exactly `1250`. The money figures beside it are exact, and the invariant is decided by cross-multiplication rather than from this ratio, so no draft escapes on the rounding — the published ratio is simply lossier than the amounts it summarises.
- **The persetujuan DPS stage has no measurable duration at all**, for as long as no approval timestamp is stored. Two of the five spans (`pengajuan_ke_persetujuan`, `persetujuan_ke_eksekusi`) therefore report `TIDAK_TERCATAT` on executed rows today. Pengajuan-to-eksekusi, eksekusi-to-atestasi and the end-to-end span use stored timestamps; the two either side of the DPS mark wait on a migration this ticket deliberately does not make.
- **The auditor attestation has no block number.** It is relayed gasless (ADR-0009) and is not among the indexed event ABIs, so its stage carries a timestamp and no on-chain marker. No block is guessed for it.
- **Durations are floored to whole hours**, so a span is reported no longer than it was. The screen reads them back as days and hours from the same integer, so the file, the screen and the validator can never disagree.
- **The rupiah scanner now stops short of a duration word.** `1.200 jam` is a figure the report is entitled to state, and rejecting it as unclaimed rupiah would be the validator refusing a true number. An `Rp` prefix still wins over the exception. The narrow cost: an invented rupiah figure written as grouped digits and immediately followed by "jam" or "hari" escapes the scan — the claim list remains the primary defence.
- **What is measured is the process inside this system**, from proposal row to attestation — not the hours a lembaga spends drafting its report. The two are different and the distinction is stated in the notes, in the drafting prompt, and on the screen, because equating them would mislead every reader of the figure.
- **Nothing is stored**, so there is no history of which drafts were rejected and why beyond the response itself.
- **The live drafting call is not covered by an automated test.** Transport tests use simulated completions, not a paid model call. Whether DeepSeek follows the Indonesian reporting prompt consistently and responds fast enough for a demo still requires a live rehearsal.
- **JSON output is not schema enforcement.** DeepSeek can return empty content or an incomplete response; schema validation and finish-reason checks must remain in the server. A refusal or unavailable draft has no provider fallback: the figures still stand and the missing narrative is stated.

## References
- Spec: GitHub issue #61; tickets #62–#66
- Related: ADR-0017 (pure core, integer money, decimal strings on the wire), ADR-0006 (separation of DPS and Auditor powers), ADR-0012 (feature-driven frontend), ADR-0016 (technology vendor positioning)
- Evidence: `docs/research/0002-baznas-pelaporan-audit-dan-ai.md`
- DeepSeek: [Chat completions](https://api-docs.deepseek.com/api/create-chat-completion/), [JSON output](https://api-docs.deepseek.com/guides/json_mode/), [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)
