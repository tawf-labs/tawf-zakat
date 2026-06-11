# ZKT on Solana — Phase 1

Quasar program implementing the Phase 1 guarded launch (see `docs/adr/0003`):
campaign pools, capped donations, organizer whitelist, the 30-day zakat
lifecycle (deadline → grace → one extension → permissionless redistribution),
and PDA donation receipts. No governance, no ZK yet — Phase 2+ (ADR-0002).

## Layout

- `zkt_core/` — the program (`src/state.rs`, `src/instructions/`, `src/tests.rs`)

## Toolchain

- Quasar CLI built from source, **pinned to `a89a9329f05740a20520607608b2b3b78c74f7c4`**
  (2026-05-31) — same rev as the `quasar-lang`/`quasar-spl` deps in
  `zkt_core/Cargo.toml`. Quasar has no releases (ADR-0001); update the pin
  deliberately, never `branch = "master"`.
  ```sh
  git clone https://github.com/blueshift-gg/quasar
  git -C quasar checkout a89a9329f05740a20520607608b2b3b78c74f7c4
  cargo install --path quasar/cli --locked
  ```
- Solana CLI 3.x (Agave), Rust 1.95+.

## Commands

```sh
cd zkt_core
quasar build        # SBF build + client codegen (target/client/)
quasar test         # QuasarSVM test suite (9 tests)
quasar deploy -u devnet -k <payer.json>
```

## Before any real deploy

- [ ] `quasar keys new` — replace the scaffold program id in `declare_id!`
- [ ] Upgrade authority → Squads multisig (never a personal keypair)
- [ ] `init_config` authority + fallback must be Squads vault addresses
- [ ] Donation mint on mainnet: official IDRX `idrxZcP8xiKkYk6XGD4uz1dxEYCWSgKDHqgjsBbwDur`
      (2 decimals; beware the deprecated old mint and pump.fun fakes)
