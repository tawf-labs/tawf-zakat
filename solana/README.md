# zkt_hackathon_solana

A confidential Solana app built with Arcium: an Anchor program queues computations, and Arcis instructions define the confidential logic.

## Quickstart

```bash
arcium build
arcium test
```

## Layout

| Path | Purpose |
|------|---------|
| `programs/zkt_hackathon_solana/` | Anchor program: queues computations, handles callbacks |
| `encrypted-ixs/` | Arcis confidential instructions |
| `tests/zkt_hackathon_solana.ts` | TypeScript integration tests |
| `Arcium.toml` | Localnet and cluster configuration |

## Docs

<https://docs.arcium.com/developers>
