# ADR 0016: Commercial Positioning — Technology Vendor, Not Licensed Amil

- **Status:** Accepted
- **Date:** 2026-09-06
- **Domain:** Commercial Strategy, Regulatory Positioning, Go-to-Market, Business Model
- **Supersedes:** the informal "SaaS to amil zakat" thesis and the "2,5% of hak amil per transaction" pricing idea
- **Evidence base:** [`docs/research/0002-baznas-pelaporan-audit-dan-ai.md`](../research/0002-baznas-pelaporan-audit-dan-ai.md) plus a market study conducted 2026-09-05/06

---

## 1. Context and Problem Statement

The project won **2nd place at Rakornas & BAZNAS Awards 2025** (26–29 August 2025, Jakarta, ±1,200 participants from across Indonesia). Following that, the team lead proposed turning ZKT into a commercial SaaS sold to *amil zakat* institutions. A separate mentoring session — prompted by uncertainty about where revenue would come from — suggested the team should **become a licensed amil (LAZ)** so that zakat funds would flow through its own accounts, monetised by taking **2.5% out of the 12.5% hak amil**.

Two problems made this untenable, and neither was visible without the regulatory research:

**Problem 1 — The revenue model was legally and commercially unsound.** The phrase "2.5% of the 12.5%" is ambiguous between taking 2.5 percentage points of *collection* (≈20% of every institution's entire operating budget; Rp297 billion/year extracted nationally) and 2.5% of the *hak amil value* (≈Rp8–85 million/year per institution). The first reading invites regulatory intervention; the second is viable but must not be framed as a share of zakat. Worse, the product's headline promise is *"we enforce the 12.5% hak amil cap"* — while taking a cut of that same cap. A pengawas syariat would ask, in the first meeting: *"You are not an amil. On what basis do you receive the amil portion?"*

**Problem 2 — Becoming a LAZ is structurally incompatible with being a commercial vendor.** UU 23/2011 Pasal 18 ayat (2) requires a LAZ to be a registered Islamic *ormas* in education/dakwah/social work (huruf a), a legal entity (huruf b), holding a **BAZNAS recommendation** (huruf c), and **bersifat nirlaba** (huruf f). PMA 19/2024 adds minimum annual collection thresholds of Rp2 billion (kab/kota), Rp10 billion (provinsi), and Rp30 billion (nasional). A commercial PT cannot satisfy huruf (f). A dual PT+Yayasan structure is legal but constrained: a yayasan may invest at most **25% of its total assets** in a business entity, and its pengurus/pengawas/pembina are **barred from serving as that entity's directors or commissioners** (UU 16/2001 jo. UU 28/2004) — so the founders could not lead both.

Above all: **the moment the team announces an intent to become a LAZ, every BAZNAS and LAZ stops seeing it as a vendor and starts seeing it as a competitor for the same muzaki.** No institution hands its muzaki database to a prospective rival. That cost is paid immediately, for a benefit that arrives in three to five years.

The decisive precedent: **Kitabisa**, Indonesia's largest fundraising platform, is explicitly *not* a zakat institution. It holds a PUB permit from Kemensos and partners with licensed LAZ (BAZNAS, Dompet Dhuafa, Rumah Zakat) for zakat. BAZNAS itself already operates **ZakatHub**, an official umbrella program letting non-LAZ entities and BAZNAS daerah run online zakat fundraising. With far greater resources, the largest player chose infrastructure over licensure.

---

## 2. Decision Drivers

- **Time to first revenue.** A vendor can invoice this quarter. A LAZ applicant cannot collect legally until licensed, and cannot be licensed until it has already collected Rp2 billion — a circular requirement resolvable only under another entity's umbrella.
- **No conflict of interest with the customer.** The two live contacts — **BAZNAS Riau** (BAZNAS Provinsi) and **UPZ IPB** — are precisely the parties that a future LAZ would compete against.
- **Criminal-liability avoidance.** UU 23/2011 Pasal 38 forbids acting as amil without a permit (Pasal 41: up to 1 year detention / Rp50 million). Pasal 37 forbids transferring zakat under management (Pasal 40: up to 5 years / Rp500 million). Any custody of zakat funds prior to licensure is exposure, not a shortcut.
- **Same source of funds, different legal position.** Institutions may pay a vendor invoice from their operational budget, which is itself sourced from hak amil (PP 14/2014 Pasal 67, provided it is recorded in the RKAT and defensible on produktivitas/efektivitas/efisiensi). Being paid *from* hak amil requires no licence; taking a *share of* hak amil does.
- **Do not antagonise the mandate-holder.** SiMBA is mandatory (PerBAZNAS 1/2023 Pasal 16–17), free, functionally broad (RKAT → muzaki → mustahik → kas → operasional; 88 sub-reports; already PSAK 109-aligned), and was rebuilt in 2024–2025 at a cost of roughly Rp4.8 billion. Displacing it is a regulatory act, not a market act.
- **Sell into an unmet gap, not a served one.** Recording is solved by both SiMBA and incumbent vendors. **Audit-readiness is not**: only 115 of 722 OPZ (15.9%) held an audited FY2023 financial statement, and Kemenag audited only 65 institutions (9.25%) for sharia compliance in 2023.

---

## 3. Considered Options

| # | Option | Zakat funds flow through us? | Time to legal | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Pure technology vendor** (PT, subscription) | No | Immediate | **Selected** |
| 2 | **Software for UPZ**, paid by the host institution | No | 1–3 months | **Selected** |
| 3 | **Platform + partner LAZ** (Kitabisa / ZakatHub model) | No — settles to the partner LAZ account | 3–6 months | **Selected, deferred to month 12** |
| 4 | **Dual entity** — PT for software, Yayasan as future LAZ | Eventually | 2–4 years | Deferred 24 months |
| 5 | **Become a LAZ directly**, abandon the commercial product | Yes | 3–5 years | Rejected |

Options 4 and 5 share one hidden cost: they convert customers into competitors on the day they are announced.

---

## 4. Decision Outcome

**We position ZKT as a technology vendor operating a commercial PT. We do not seek an amil licence, and no zakat funds pass through accounts we control. The ambition to become an amil is deferred — not cancelled — for 24 months.**

### 4.1 Sequencing

- **Months 0–6 — Options 1 and 2 in parallel.** Two segments, no licence of any kind required:
  - **BAZNAS Riau** as a *design partner* (free) for the audit-readiness layer aimed at BAZNAS Provinsi. Their concrete pain is compiling the mandated *laporan zakat wilayah* (PerBAZNAS 1/2023 Pasal 6 ayat (7)) from **12 kabupaten/kota** whose data does not pass through them, because kab/kota report directly to BAZNAS pusat via SiMBA.
  - **UPZ IPB** as the *first paying customer* for the UPZ product, invoiced to the host institution's budget rather than to hak amil.
- **Month 12 — Option 3.** If funds must flow, do it under a partner-LAZ or ZakatHub arrangement: funds settle to the licensed partner's account; we invoice a technology service fee.
- **Month 24 — reopen the LAZ question**, with a track record, partners, and the possibility that it is no longer needed.

### 4.2 Pricing

Subscription tiers, anchored to the market (ZAINS ≈ Rp30 million/year; SoftwareZakat.com Rp6–24 million/year), with an explicit ceiling. Percentage-of-hak-amil pricing is **rejected** — it collapses at large institutions (2.5% of a LAZ Nasional's hak amil is ≈Rp447 million/year for identical work).

| Segment | Price | As % of that segment's average hak amil |
| :--- | ---: | ---: |
| UPZ (host institution pays) | Rp9 million/year | n/a — does not touch hak amil |
| BAZNAS Kabupaten/Kota | Rp24 million/year | 4.47% |
| BAZNAS Provinsi | Rp60 million/year | 1.76% |
| LAZ Nasional | Rp90 million/year | 0.50% |

Five legal revenue streams: subscription · one-off implementation fee (this funds the intensive onboarding the team considers a differentiator) · technology service fee via partner LAZ (from month 12) · vendor work for BAZNAS pusat (the 2024 SiMBA managed-services package was tendered at **Rp3.4 billion/year**) · grant/CSR funding for the public-good component.

Indicative trajectory, with no licence and no custody: **Rp84 million (Y1) → Rp810 million (Y2) → Rp3.38 billion (Y3)**.

### 4.3 Product positioning

- **Complement SiMBA, never replace it.** Export-to-upload initially; pursue the officially offered **host-to-host** integration (PerBAZNAS 1/2023 Pasal 18 ayat (1) huruf b) once a relationship with BAZNAS pusat's IT function exists. The third-party integrator ecosystem is effectively empty — the only public SiMBA client library has 12 installs — so this is genuinely open ground.
- **Sell the layer nobody occupies: audit-readiness and reconciliation**, not record-keeping.
- **Frame fraud prevention as "proving the institution is clean", never as "preventing the amil from cheating".** Same technology; entirely different buyer. Institutional leadership will pay for exculpatory evidence; nobody buys their own ankle monitor.
- **Keep the blockchain layer invisible in the UI.** Lead with hours saved and audit confidence; disclose the ledger only when a buyer asks *how* a figure can be proven.
- **Never describe fees as a share of hak amil.** The correct wording is a subscription paid from the institution's operational budget, recorded in the RKAT.

#### 4.3.1 When the on-chain layer is foregrounded, and when it is not (added with Spec #61)

"Keep the blockchain layer invisible in the UI" above is a rule about *buyers*, not a rule about every audience, and the distinction is worth stating rather than leaving to instinct. **In front of a buyer** — an institution's leadership deciding on a subscription — the ledger stays behind the answer: lead with hours saved and with the fact that every figure in the report was checked against the records underneath it, and disclose the chain only when they ask *how* that can be proven. A buyer who has to understand the mechanism before they can value the outcome has been sold the wrong thing. **In front of a jury, a regulator, or an auditor** — anyone whose question is *why should I believe this* — the ledger is the answer and is shown first, because what they are assessing is precisely the mechanism: the immutability of the block number behind a timestamp, the contract-locked 12,5% hak amil ceiling, and now (ADR-0018) the fact that a model's output is never the last step. The same is true of the deterministic validator: a buyer is shown a report they can sign, an assessor is shown a wrong draft being rejected by the system's own rule.

---

## 5. Consequences

**Positive**

- Revenue is legally available immediately; no licensing gate, no custody, no Pasal 37/38 exposure.
- BAZNAS Riau and UPZ IPB remain prospective customers rather than becoming competitors.
- The corporate form stays a commercial PT; no forced conversion to a non-profit structure.
- The Rakornas 2025 award stays usable as a national credential for cold outreach to ~542 BAZNAS daerah decision-makers, without the awkwardness of soliciting a BAZNAS recommendation to compete with BAZNAS.
- The UPZ segment sidesteps hak amil politics entirely, because the host institution pays from its own budget.

**Negative / accepted trade-offs**

- Total addressable market is bounded. The formal market is 748 licensed OPZ; at these prices national ARR potential is on the order of tens of billions of rupiah, not hundreds. This is a profitable small-team business, not a venture-scale outcome.
- Two incumbent vendors are already established — **ZAINS** (from Rp2.5 million/month; clients reportedly include Rumah Zakat and BAZNAS Jabar) and **SoftwareZakat.com** (operating since 2009) — both already claiming PSAK 109 accounting. We compete by moving up a layer, not by matching features.
- We remain dependent on BAZNAS goodwill for host-to-host access, which has no public API documentation and is gated by relationship rather than by contract.
- Deferring the LAZ ambition may disappoint stakeholders who see hak amil as the larger prize.

**Neutral**

- The UPZ segment thesis (>100,000 units; BAZNAS pushing UPZ at every campus and every desa/kelurahan) is an inference from market structure, not yet validated demand. It is cheap to test and must be tested before it is resourced.

---

## 6. Guardrails

These are red lines, not preferences.

1. **No zakat funds in accounts we control** until and unless an amil licence exists. Ordering is licence first, custody second — never the reverse.
2. **No public or private statement of intent to become a LAZ** while selling to BAZNAS or LAZ, for the next 24 months.
3. **Fees are invoiced, never deducted from zakat flow.**
4. **No positioning as a SiMBA replacement** in any deck, email, or conversation.
5. **Before the pricing model is offered commercially**, obtain a written sharia opinion — first from a partner institution's DPS, then from a fiqh muamalah academic.

---

## 7. Open Items

| # | Item | Why it matters | Owner |
| :--- | :--- | :--- | :--- |
| 1 | Read **PMA 19/2024** and **PerBAZNAS 2/2016** end to end | The entire preceding debate happened because nobody had read the licensing and UPZ rules | *unassigned — must be named* |
| 2 | Obtain the Rakornas 2025 award certificate and record the exact category name | It will appear in every email and deck for two years; the category is not documented publicly | — |
| 3 | Get inside SiMBA via a 30-minute screen-share with BAZNAS Riau | The team has only ever seen the public login page; the "SiMBA is outdated" claim is currently unevidenced | — |
| 4 | Measure hours spent producing the annual report, and how many times identical data is re-keyed | The single most persuasive number available, and it does not yet exist | — |
| 5 | Confirm whether IPB will budget for UPZ software from institutional funds | The entire Option 2 thesis rests on the host institution, not the UPZ, being the payer | — |
| 6 | Verify whether SiMBA's host-to-host API is documented and obtainable | Determines whether double data entry can actually be eliminated | — |

---

## 8. References

- **Regulations:** UU 23/2011 (Pasal 16, 18, 29, 30–32, 37–41) · PP 14/2014 (Pasal 67, 71–76) · PerBAZNAS 1/2023 (Pasal 6, 13, 16–18, 24) · PerBAZNAS 2/2016 (UPZ) · PMA 19/2024 · KMA 606/2020 · UU 16/2001 jo. UU 28/2004 (Yayasan) · PSAK 409
- **Data:** Laporan Pengelolaan Zakat Nasional Akhir Tahun 2024 & 2025 (BAZNAS) · RUP BAZNAS 2024 (PPID BAZNAS)
- **Internal:** [`docs/research/0002-baznas-pelaporan-audit-dan-ai.md`](../research/0002-baznas-pelaporan-audit-dan-ai.md) — §5 data-quality evidence, §7 pusat–daerah friction, §10 candidate features, §11 regulatory limits
- **Code touchpoints:** `sc/src/ZakatProtocolL1.sol` — `MAX_AMIL_BPS` (line 39), `SHARIA_SUPERVISOR_ROLE` / `AUDITOR_ROLE` (lines 36–37) · ADR-0006, ADR-0009, ADR-0015

> Written in English to match the existing ADR series; regulatory terms are kept in Indonesian verbatim. Say the word if you would rather this one be in Bahasa Indonesia like the research document.
