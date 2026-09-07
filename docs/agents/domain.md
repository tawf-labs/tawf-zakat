# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Current scope and implementation evidence

- **Pilot scope:** read [ADR-0020](../adr/0020-institutional-pilot-evidence-and-reconciliation.md), [ADR-0021](../adr/0021-period-evidence-institutional-endorsement-and-private-sources.md), and [ADR-0022](../adr/0022-append-only-report-evidence-registry.md). They define period evidence, restricted sources, and a separate registry with revision history and institution/validator endorsements for publication. [Design](../design/period-evidence-registry.md) separates agreed architecture from details still to specify; [research 0004](../research/0004-smart-contract-project-fit-grilling.md) holds the evidence and decision log.
- **Active governance and deployment:** read [ADR-0019](../adr/0019-receipt-verified-governance-and-clean-redeployment.md) and the [2026-09-08 deployment manifest](../deployments/2026-09-08-arbitrum-sepolia.md), then inspect code/config for the behaviour being discussed. Distinguish a recorded deployment snapshot from current RPC observations.
- **Historical context:** the [archived CONTEXT](../../archive/CONTEXT-2026-09-08-before-pilot.md) preserves the earlier implementation narrative. Root and smart-contract READMEs still mix older DAO/ZK and Sepolia deployments; resolve their claims against the relevant ADR, manifest, and active code before relying on them.

## File structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
