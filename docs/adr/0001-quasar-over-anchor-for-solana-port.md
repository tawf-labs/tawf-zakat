# Quasar over Anchor for the Solana port

The platform is being ported to Solana as an additional chain (the Ethereum Sepolia contracts stay untouched). We chose [Quasar](https://github.com/blueshift-gg/quasar) over Anchor as the program framework because cost is the deciding factor: Quasar's zero-copy `no_std` design produces smaller binaries (cheaper program deployment rent) and lower compute-unit usage per transaction, which compounds at scale for a high-volume donation platform.

## Consequences

- Quasar is an unaudited beta with no published crate releases (as of June 2026). We must pin to a specific git commit and expect API churn; a future security audit will need to cover the framework, not just our program code.
- A previous Solana attempt (commit `f853446`, Anchor 1.0.2 + Arcium MPC for confidential execution) was abandoned by a prior developer and rolled back; this port starts fresh and does not reuse the Arcium approach.
- Quasar's API deliberately mirrors Anchor, so a fallback migration to Anchor before audit/mainnet remains feasible if the maturity risk becomes unacceptable.
