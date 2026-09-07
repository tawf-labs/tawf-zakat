# Fresh Manual-Test Deployment

- Date: 2026-09-08 (Asia/Jakarta)
- Chain: Arbitrum Sepolia, 421614
- Protocol: `0x0D6CeC28a574ACa41b879767b081F6f2B4E9a849`
- MockUSDC: `0x1F439a83354ae624a4E8aCBC4e9873Eaa2e1f852` (6 decimals)
- Protocol deployment block / indexer start: `306477711`
- Admin and relayer: `0x5e9B652C4E8a013f6fAb69F0b55377c408B59968`
- DPS: `0x6214e4E81a075c7CA6F4B5725eCd943D1C6b642C`
- Auditor: `0xe8A4Ee352B95A4FC08667Df5d85c167006FE2A2f`

## Transactions

- MockUSDC: `0xe7074fad22f7185d1fe74b780b5b36a6bc813755fb3f02340e2bbb49f383fa7a`
- Protocol: `0xcf3d46490f9ec2acd8a6ab3b59c9ec3f12882e8eb748c8aff329404f5d3acac1`
- Combined gas cost: `0.000504154371844 ETH` (testnet)
- Both contracts verified by Sourcify with `exact_match`.

## Initial State

Verified onchain at block 306477958: proposal counter, collected/disbursed totals
in both currencies, and token total supply were all zero. No mint, deposit,
proposal, approval or execution was sent. Admin has only admin/relayer roles;
DPS and auditor each have only their designated role.

The local database contains zero donations, batches, proposals and auditor
profiles. The only initial records are four constructor RoleGranted events,
four role entries and one deployment-scoped checkpoint. Auditor identity
onboarding is intentionally left for manual testing.

Backend and frontend environment/config addresses are synchronized. Local API
and embedded indexer are active; VPS PM2 and its startup service remain disabled.
Frontend: http://localhost:3000. API: http://localhost:3001.

## Corrections and Verification

MockUSDC inherited 18 decimals from ERC20; an override now returns 6. A new
Foundry regression test failed at 18 before this correction. All 23 protocol
tests pass, including 256-run fuzz coverage of the split invariant.

The previous hard-coded DPS and auditor hashes were swapped in application
constants. Backend hashes are now derived from Solidity role names; the indexer
and frontend use matching values, covered by a cross-layer regression test.
The four initial database role labels were corrected without changing grants.
The roster no longer displays historical hard-coded accounts.

Frontend/backend builds and desktop/mobile browser checks passed. Governance
transactions were not exercised on the live fresh deployment, to preserve the
requested empty state. Existing legacy-suite failures documented in ADR-0019
are not resolved by redeployment.

## Testnet-Only Risk

The user explicitly approved reusing the historical compromised admin/deployer
wallet for testnet only. Anyone holding that exposed key can control its roles.
Do not fund this wallet with real assets or reuse this deployment as production.
This deployment is not a security audit or a change to the protocol's existing
Solidity governance policy; see ADR-0019 for remaining policy limitations.
