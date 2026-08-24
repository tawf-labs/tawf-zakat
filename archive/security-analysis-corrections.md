# Security Analysis Text & Reference Corrections

Below are the exact text replacements and reference cleanup actions needed for the security analysis section.
Search for the "CURRENT" text in your Word document and replace with "CORRECTED".
Follow the **REFERENCE ACTION** for each citation bracket.

---

## 1. Opening Event Block (Wrong Event)

**CURRENT:**
```
The only on-chain observable from a private donation is the event emitted by ZKTCore.sol (lines 577–582):

event ZKDonationReceived(
    uint256 indexed poolId,
    bytes32 indexed nullifier,
    uint256 amount,
    address indexed donor
);
```

**CORRECTED:**
```
The only on-chain observable from a private donation is the event emitted by PrivateDonationPool.sol:

event PrivateDonationReceived(
    uint256 indexed poolId,
    bytes32 indexed nullifier,
    bytes32 amountCommitment
);
```

**REFERENCE ACTION:** None in this block. (Preceding sentence `[11][7]` → **KEEP** — cites prior privacy models.)

---

## 2. Private Mode Routing Description

**CURRENT:**
```
In Private mode, donations route through donateZKPrivate(), which verifies a ZK eligibility proof and routes funds to a PrivateDonationPool contract [10][18].
```

**CORRECTED:**
```
In Private mode, donations route through donateZKPrivate(), which verifies a ZK eligibility proof and routes funds to a PrivateDonationPool contract.
```

**REFERENCE ACTION:** **REMOVE `[10][18]`** — Describes your own contract routing logic, not external literature.

---

## 3. Circuit Outputs Description (Imprecise)

**CURRENT:**
```
The Noir circuit computes two public outputs: a nullifier and an amount of commitment pedersen(secret, amount), binding the donation amount to the donor's secret inside the ZK witness.
```

**CORRECTED:**
```
The Noir circuit computes two public outputs: a nullifier pedersen(secret, recipient_address, cycle_id) and an amount commitment pedersen(secret, amount), binding the donation amount to the donor's secret inside the ZK witness.
```

**REFERENCE ACTION:** **KEEP `[20][8]`** (if present) — Cites cryptographic primitives (Pedersen hash).

---

## 4. Private Donation Event Description

**CURRENT:**
```
The on-chain event PrivateDonationReceived(poolId, nullifier, amountCommitment) exposes neither the donor address nor the amount in the event log [11].
```

**CORRECTED:**
```
The on-chain event PrivateDonationReceived(poolId, nullifier, amountCommitment) exposes neither the donor address nor the amount in the event log.
```

**REFERENCE ACTION:** **REMOVE `[11]`** — Describes your own event signature.

---

## 5. Amount Visibility Limitation

**CURRENT:**
```
The amount remains visible in raw transaction calldata due to the transferFrom semantics while moving the amount fully into the circuit witness with fixed-denomination tiers is reserved for future work [29].
```

**CORRECTED:**
*(No text change needed.)*

**REFERENCE ACTION:** **KEEP `[29]`** — Cites related work on fixed-denomination privacy schemes.

---

## 6. ZKVerifier Description

**CURRENT:**
```
The ZKVerifier contract anchors proof hashes on-chain via keccak256 and tracks spent nullifiers to prevent replay [8][10] while full UltraHONK on-chain verification is reserved for future work and depends on deploying the Barretenberg-generated verifier (which currently exceeds the 24 KB EIP-170 code size limit on Sepolia) [8].
```

**CORRECTED:**
```
The ZKVerifier contract anchors proof hashes on-chain via keccak256 and tracks spent nullifiers to prevent replay, while full UltraHONK on-chain verification is reserved for future work and depends on deploying the Barretenberg-generated verifier (which currently exceeds the 24 KB EIP-170 code size limit on Sepolia) [8].
```

**REFERENCE ACTION:** **REMOVE `[8][10]`** — Describes your own contract. **KEEP `[8]`** at the end — Cites EIP-170 standard.

---

## 7. NullifierRegistry Description

**CURRENT:**
```
The NullifierRegistry prevents double-donation [20][8].
```

**CORRECTED:**
```
The NullifierRegistry prevents double-donation.
```

**REFERENCE ACTION:** **REMOVE `[20][8]`** — Describes your own contract.

---

## 8. Recipient Privacy — Contradictory Claim

**CURRENT:**
```
Recipient privacy: The Pedersen-hash nullifier [8][20] binds each claim to a recipient without revealing their address. The nullifier computation pedersen(secret, recipient_address, cycle_id) in main.nr means the on-chain nullifier is deterministic but preimage-resistant [20]. An observer sees 0x3f2a… and cannot recover the recipient address or secret [7][10].
```

**CORRECTED:**
```
Recipient privacy: The Pedersen-hash nullifier [8][20] binds each claim to a recipient. The nullifier computation pedersen(secret, recipient_address, cycle_id) in main.nr means the on-chain nullifier is deterministic but preimage-resistant [20]. An observer sees 0x3f2a… and cannot recover the secret or recipient address from the nullifier alone. However, the recipient address is a public circuit input visible in transaction calldata.
```

**REFERENCE ACTION:** **KEEP `[8][20]`** and `[20]` — Cite cryptographic properties. **REMOVE `[7][10]`** — Internal claim about observer capabilities; contradicts later accurate statement about calldata visibility.

---

## 9. Circuit Soundness

**CURRENT:**
```
Circuit soundness: Under the q-PKE assumption [10], forging a proof that passes UltraHONK verification is computationally infeasible [18][8]. A non-eligible recipient, whose wealth exceeds the nisab threshold as checked by verify_nisab() in main.nr, cannot produce a witness that satisfies the circuit constraints [9][16].
```

**CORRECTED:**
*(No text change needed.)*

**REFERENCE ACTION:** **KEEP `[10]`, `[18][8]`** — Cite cryptographic assumptions and proof system security. **REMOVE `[9][16]`** — Describes your own `verify_nisab()` function.

---

## 10. Double-Donation Prevention — Wrong Function Reference

**CURRENT:**
```
The ZKTCore.donateZK() function atomically chains honkVerifier.verify() → nullifierRegistry.spend() → zakatEscrowManager.donate() [7][28].
```

**CORRECTED:**
```
The ZKTCore.donateZKPrivate() function atomically chains honkVerifier.verify() → nullifierRegistry.spend() → privateDonationPool.donatePrivately().
```

**REFERENCE ACTION:** **REMOVE `[7][28]`** — Describes your own function call chain.

---

## 11. Double-Donation Prevention — Revert & Cycle Limit

**CURRENT:**
```
A duplicate nullifier causes the transaction to revert [8]. Each eligible recipient can claim zakat at most once per cycle [5][6].
```

**CORRECTED:**
```
A duplicate nullifier causes the transaction to revert. Each eligible recipient can claim zakat at most once per cycle.
```

**REFERENCE ACTION:** **REMOVE `[8]`, `[5][6]`** — Describes your own code behavior and internal design decision.

---

## 12. Double-Donation Prevention — Address Visibility

**CURRENT:**
```
The nullifier hash is preimage-resistant, so an observer cannot derive the recipient address from it [20][10], but the address itself is a public circuit input visible in the transaction calldata [18].
```

**CORRECTED:**
*(No text change needed.)*

**REFERENCE ACTION:** **KEEP `[20][10]`** — Cites hash property. **REMOVE `[18]`** — Describes your own public inputs.

---

## 13. Future Work Reference

**CURRENT:**
```
Full recipient privacy depends on encrypted note disbursement reserved for future work [30].
```

**CORRECTED:**
*(No text change needed.)*

**REFERENCE ACTION:** **KEEP `[30]`** — Cites related work on encrypted notes.

---

## 14. Privacy Exposure Analysis — Opening

**CURRENT:**
```
Privacy Exposure Analysis. The current prototype exposes several privacy vectors beyond those resolved by the nullifier mechanism [29][18].
```

**CORRECTED:**
```
Privacy Exposure Analysis. The current prototype exposes several privacy vectors beyond those resolved by the nullifier mechanism.
```

**REFERENCE ACTION:** **REMOVE `[29][18]`** — Internal analysis statement.

---

## 15. Recipient Address Exposure

**CURRENT:**
```
The recipient address is a public circuit input transmitted in the calldata of every donateZK() transaction [16][11]. This makes it visible to blockchain observers and to the amil institution [6].
```

**CORRECTED:**
```
The recipient address is a public circuit input transmitted in the calldata of every donateZKPrivate() transaction. This makes it visible to blockchain observers and to the amil institution.
```

**REFERENCE ACTION:** **REMOVE `[16][11]`, `[6]`** — Describes your own code and internal stakeholder visibility.

---

## 16. Donor Address Event Claim (Wrong Event)

**CURRENT:**
```
The donor address is emitted in the ZKDonationReceived event [11].
```

**CORRECTED:**
```
The donor address is passed as msg.sender to privateDonationPool.donatePrivately() but is not emitted in any event log.
```

**REFERENCE ACTION:** **REMOVE `[11]`** — Incorrect event reference; describes your own code.

---

## 17. Transaction Graph & Side-Channels

**CURRENT:**
```
Transaction graph analysis on the public Sepolia ledger could correlate donation timing with recipient claim timing [29]. The backend API proving model does not protect against network-level or side-channel attacks [18].
```

**CORRECTED:**
*(No text change needed.)*

**REFERENCE ACTION:** **KEEP `[29]`, `[18]`** — Cite established analysis methods and security literature.

---

## 18. Aggregate Patterns

**CURRENT:**
```
Donations to the same pool reveal aggregate economic patterns when individual amounts are hidden [7].
```

**CORRECTED:**
```
Donations to the same pool reveal aggregate economic patterns when individual amounts are hidden.
```

**REFERENCE ACTION:** **REMOVE `[7]`** — Internal observation about your protocol.

---

## 19. Future Work Roadmap

**CURRENT:**
```
Each of these exposures is acknowledged as a limitation of the current prototype and is addressed in the future work roadmap through encrypted note disbursement [30], private decentralized identifiers [19], and integration with on-chain mixer patterns [29].
```

**CORRECTED:**
*(No text change needed.)*

**REFERENCE ACTION:** **KEEP `[30]`, `[19]`, `[29]`** — All cite related external work.

---

## 20. Conclusion

**CURRENT:**
```
The security analysis confirms that the protocol meets its design goals [7][11].
```

**CORRECTED:**
```
The security analysis confirms that the protocol meets its design goals.
```

**REFERENCE ACTION:** **REMOVE `[7][11]`** — Internal conclusion.

---

## Summary of Reference Actions

| Ref | Context | Action | Why |
|-----|---------|--------|-----|
| [5][6] | Cycle limit claim | **REMOVE** | Internal design decision |
| [7] | Aggregate patterns / Design goals | **REMOVE** | Internal observation / conclusion |
| [8] | NullifierRegistry / Revert | **REMOVE** | Describes your own contract |
| [8] | EIP-170 limit | **KEEP** | Cites Ethereum standard |
| [9][16] | verify_nisab() constraints | **REMOVE** | Describes your own code |
| [10][18] | PrivateDonationPool routing | **REMOVE** | Describes your own contract |
| [10] | q-PKE assumption | **KEEP** | Cites cryptographic assumption |
| [11] | Event log / Calldata | **REMOVE** | Describes your own event/code |
| [16][11] | Calldata exposure | **REMOVE** | Describes your own code |
| [18] | Side-channels / Graph analysis | **KEEP** | Cites security literature |
| [18] | Public circuit input | **REMOVE** | Describes your own code |
| [19] | Private DIDs | **KEEP** | Cites related work |
| [20][8] | NullifierRegistry / Pedersen | **REMOVE** (first) / **KEEP** (second) | First describes contract; second cites crypto primitive |
| [29] | Fixed denominations / Mixers / Graph analysis | **KEEP** | Cites related work |
| [30] | Encrypted notes | **KEEP** | Cites related work |

**Rule of thumb applied:** References to external literature, standards, or cryptographic assumptions are kept. References to your own code, events, functions, or internal design decisions are removed. Your code is the artifact being analyzed and does not need to cite itself.
