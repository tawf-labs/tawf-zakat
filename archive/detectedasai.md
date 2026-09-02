Abstract—Zakat, one of the five pillars of Islam, represents
a mandatory annual obligation for wealth redistribution with
profound social welfare implications. Despite growing interest
in blockchain-based zakat platforms, existing systems expose
complete donor-recipient transaction records on public ledgers,
creating a fundamental tension with Islamic principles of dignity
preservation. This paper proposes a Zero-Knowledge Private
Zakat (ZK-PZ) protocol that enables cryptographically private
donations while maintaining verifiable transparency and Sharia
compliance. The proposed architecture leverages off-chain zero-
knowledge proving infrastructure, implementing programmable
privacy through Noir circuits, nullifier-based double-donation
prevention, and selective disclosure mechanisms. Donors can
contribute zakat with complete anonymity or selective disclo-
sure while receiving SBT receipts as proof of donation. The
protocol preserves institutional trustworthiness through on-chain
verification of proof validity while eliminating public exposure
of individual transaction data. A prototype implementation
on Ethereum Sepolia demonstrates technical feasibility, with
UltraHONK proof generation averaging 247 ms and end-to-
end donation gas costs of 721,345 gas per transaction. The
results indicate that cryptographic privacy and institutional
transparency are simultaneously achievable, opening a practical
path toward privacy-respecting digital zakat infrastructure for
Muslim-majority jurisdictions. This work proposes a domain-
specific privacy protocol designed for Islamic social finance,
directly addressing the maqasid al-shariah imperative of nafs
(dignity) protection.
Index Terms—Aztec Network, Blockchain, Ethereum Sepolia,
Islamic FinTech, Noir, Nullifier Mechanism, Privacy-Preserving
Donations, Sharia Compliance, Zakat, Zero-Knowledge Proofs
I. INTRODUCTION
Zakat management at the intersection of Islamic jurispru-
dence and modern blockchain infrastructure presents both
an opportunity and a challenge. BAZNAS [1] reports that
the annual zakat potential in Indonesia alone is estimated at
Rp 327 trillion (approximately USD 20 billion), while actual
collection remains a fraction of that figure.
The advent of distributed ledger technology has prompted
substantial research into blockchain-based zakat systems.
Khan [2] demonstrated that blockchain can provide decentral-
ized zakat collection and distribution.

security align with zakat management objectives in Malaysia.
Khairi et al. [4] developed a zakat collection blockchain
system that offers automated disbursement and an immutable
audit trail. However, these systems introduce a critical pri-
vacy paradox. By placing complete donor-recipient trans-
action records on public ledgers, they inadvertently expose
socioeconomic vulnerabilities. The principle of maqasid al-
shariah (objectives of Islamic law) explicitly protects nafs (life
and dignity) of individuals [5, 6]. In Islamic jurisprudence,
preservation of donor and recipient privacy during charitable
giving is considered a virtuous act that maintains dignity for
both parties. This ethical foundation motivates the technical
contribution: a protocol that uses ZK proofs to reconcile
Islamic jurisprudential requirements with modern blockchain
infrastructure.
Zero-Knowledge Proofs (ZKPs) offer a cryptographic res-
olution to this paradox. Hameed et al. [7] survey ZKP con-
structions, and Wen et al. [8] analyze non-interactive variants
(zk-SNARKs) suitable for blockchain deployment. The Aztec
Network [9] provides an infrastructure for privacy-preserving
transactions on Ethereum. Through its hybrid public-private
state model, Aztec enables programmable privacy through
Noir circuits [10] and the UltraHONK proof system for
efficient verification. Despite these advances, no prior work
has proposed a domain-specific protocol for privacy-preserving
zakat donations. This paper addresses that gap by designing,
implementing, and evaluating a ZK Private Zakat (ZK-PZ)
protocol. The work formalizes a private transaction model
for zakat donations using off-chain proving with on-chain
verification, designs Noir circuits for Sharia-compliant eligi-
bility verification, develops a nullifier-based double-donation
prevention mechanism, and deploys a working prototype on
Ethereum Sepolia. The study explores how Aztec’s private
transaction infrastructure can be adapted for zakat donations
while maintaining institutional accountability. It examines
what Noir circuit design patterns enable Sharia-compliant
eligibility verification. It also investigates how the protocol
satisfies the tension between nafs protection and amanah
requirements in maqasid al-shariah.

DSR Methodology with five phases and literature search summary
IV. RESULTS
A. System Overview and Threat Model
The ZK-PZ protocol operates within a five-actor trust
model: donor (ZKP prover), recipient (SBT receipt holder),
amil institution (verifier), off-chain proving infrastructure
(Noir circuits and Barretenberg prover), and Ethereum Sepolia
(public settlement layer).
The threat model assumes: (1) an honest-but-curious ver-
ifier, (2) a potentially malicious claimant, and (3) a public
blockchain network subject to transaction graph analysis. The
protocol guarantees the properties summarized in Table I.
TABLE I
ZK-PZ PROTOCOL SECURITY PROPERTIES
Property Guarantee
Donor
anonymity
Identities and amounts never exposed on-chain; only ZK
proofs are publicly verifiable.
Recipient
privacy
Donor-side privacy via ZK proofs; recipient encrypted notes
reserved for future work.
Soundness Non-eligible recipient cannot generate an accepted proof
under q-PKE assumption [11].
Double-
donation
Nullifier hash prevents the same recipient from claiming
zakat more than once per cycle.
Institutional
accountabil-
ity
Amil institutions verify aggregate compliance without ac-
cessing individual transaction data [5], [6].
Fig. 4 depicts the three-layer protocol architecture: the off-
chain proving pipeline where Noir circuits compile to ACIR
and Barretenberg generates UltraHONK proofs at 247 ms, the
Sepolia settlement layer hosting ZKTCore and ZakatEscrow-
Manager, and the Next.js PWA frontend with wagmi/XellarKit
wallet connectivity.
Fig. 4. ZK-PZ Protocol Architecture: off-chain proving pipeline and on-chain
settlement
Fig. 5. ZK-PZ Donation Flow: from wallet connection to SBT receipt to the
donor
Fig. 6. ZK-PZ Smart Contract Architecture with Sepolia addresses and
cardinality
B. System Architecture and Payment Flow
The platform employs a hybrid architecture combining Noir
circuits on the client side with Ethereum Sepolia for public
settlement. Donors pay in stablecoins or ETH. Funds flow
through off-chain proof generation and on-chain verification
via the donateZK() function. This design ensures that indi-
vidual donation privacy is maintained through cryptographic
proofs while institutional accountability is achieved through
on-chain event emission and nullifier tracking.
A Progressive Web Application supports the donor-facing
workflow, providing wallet connection, privacy tier selection,
Page 5 of 7 - AI Writing Submission
Page 5 of 7 - AI Writing Submission
Submission ID trn:oid:::1:661950632
Submission ID trn:oid:::1:661950632
donation amount input, proof generation visualization, and
transaction confirmation. Proof generation runs in a Web
Worker ensuring that private inputs never leave the donor’s
device [11].
C. Circuit Performance
Circuit benchmarks used Noir v1.0.0-beta.21 and Barreten-
berg v4.2.1 on a 16-core Linux machine. 

