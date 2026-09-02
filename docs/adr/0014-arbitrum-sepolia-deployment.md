# ADR-0014: Arbitrum Sepolia Deployment and L2 Infrastructure Integration

## Status
Accepted

## Context
A key partner from the **Arbitrum** ecosystem expressed strong interest in our Zakat Transparency & Anti-Corruption Protocol (`tawf-zakat`). Arbitrum is a leading Ethereum Layer 2 Rollup offering ultra-low transaction fees (~$0.001 - $0.005 per transaction), high throughput, deep DeFi liquidity, and fast settlement finality, making it an ideal network for high-frequency micro-donations and real-time verifiable disbursement operations.

To enable comprehensive manual end-to-end testing and stakeholder demonstration, the smart contract stack needed to be deployed to **Arbitrum Sepolia** (Chain ID: `421614`), configured with dedicated MockUSDC/Circle USDC test tokens, and integrated seamlessly across frontend wallet connectors (Wagmi / ConnectKit / Reown) and backend event indexers.

## Decisions

### 1. Smart Contract Deployment on Arbitrum Sepolia (Chain ID: 421614)
- Deployed `MockUSDC.sol` (with 6 decimals and free minting faucet for testing) at `0xdb10a1ee7a3a628353d0d29db60f99d46d41e30d`.
- Deployed `ZakatProtocolL1.sol` at `0x5f2394e6bc3dd842831c66253d4433f4f72b4e7b`.
- Initialized with Deployer `0x5e9B652C4E8a013f6fAb69F0b55377c408B59968` holding all default administrative, relayer, DPS, and auditor roles.

### 2. Multi-Chain & L2 Frontend Web3 Integration
- Configured Wagmi with `arbitrumSepolia` as the primary chain with RPC `https://sepolia-rollup.arbitrum.io/rpc`.
- Configured Arbiscan Sepolia (`https://sepolia.arbiscan.io`) as the primary block explorer across all transaction toasts, proof inspection cards, and footer links.
- Maintained fallback support for Ethereum Sepolia (`11155111`) for multi-chain flexibility.

### 3. Backend Event Indexer & Configuration
- Updated `backend/.env`, `backend/src/config.ts`, `backend/src/indexer.ts`, and `backend/src/db/index.ts` to index from Arbitrum Sepolia starting block `304590800`.

## Verified Live Transactions
1. **USDC Approval**: [`0x04e8e201a78d5b34afdf29d7342c12fbe031e868c67478347fb4e3780cde7684`](https://sepolia.arbiscan.io/tx/0x04e8e201a78d5b34afdf29d7342c12fbe031e868c67478347fb4e3780cde7684)
2. **USDC Deposit (100 USDC)**: [`0x865aa14fe517abe513e1bd6fe094d1248b659685bd1ae76335b3c3e05d38ab5a`](https://sepolia.arbiscan.io/tx/0x865aa14fe517abe513e1bd6fe094d1248b659685bd1ae76335b3c3e05d38ab5a)
3. **Fiat Batch Settlement (Batch #101)**: [`0xce1cc8bb4236c2fa2ddbb2c38372215f638e300bfadf5682db982caf3a5016bf`](https://sepolia.arbiscan.io/tx/0xce1cc8bb4236c2fa2ddbb2c38372215f638e300bfadf5682db982caf3a5016bf)
4. **Disbursement Proposal (50 USDC Asnaf Fakir)**: [`0xd371d1baefe56192bf4393248f74cf625886221adba4380442d634153f08ab36`](https://sepolia.arbiscan.io/tx/0xd371d1baefe56192bf4393248f74cf625886221adba4380442d634153f08ab36)

## Consequences
- **Positive**: Platform is now fully live and verifiable on Arbitrum Sepolia L2 with sub-second finality and negligible gas costs.
- **Positive**: Direct compatibility with Arbiscan explorer and modern Arbitrum tooling.
